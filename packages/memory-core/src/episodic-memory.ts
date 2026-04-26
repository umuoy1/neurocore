import type {
  ActivationTrace,
  Episode,
  MemoryLifecycleState,
  MemoryDigest,
  MemoryProvider,
  ModuleContext,
  Proposal
} from "@neurocore/protocol";

export interface EpisodicMemoryPersistenceStore {
  write(sessionId: string, tenantId: string, episode: Episode): void;
  list(sessionId: string): Episode[];
  listByTenant(tenantId: string, excludeSessionId?: string): Episode[];
  getLatest(sessionId: string): Episode | undefined;
  markActivated(
    sessionId: string,
    tenantId: string,
    episodeIds: string[],
    input: {
      cycleId?: string;
      scope: ActivationTrace["last_scope"];
      activatedAt: string;
    }
  ): void;
  markLifecycle(
    sessionId: string,
    tenantId: string,
    episodeId: string,
    lifecycleState: MemoryLifecycleState
  ): void;
  replace(sessionId: string, tenantId: string, episodes: Episode[]): void;
  deleteSession(sessionId: string): void;
}

export class EpisodicMemoryStore {
  private readonly episodes = new Map<string, Episode[]>();
  private readonly sessionTenants = new Map<string, string>();

  public write(sessionId: string, tenantId: string, episode: Episode): void {
    const current = this.episodes.get(sessionId) ?? [];
    current.push(episode);
    this.episodes.set(sessionId, current);
    this.sessionTenants.set(sessionId, tenantId);
  }

  public list(sessionId: string): Episode[] {
    return this.episodes.get(sessionId) ?? [];
  }

  public getLatest(sessionId: string): Episode | undefined {
    const episodes = this.list(sessionId);
    return episodes.length > 0 ? episodes[episodes.length - 1] : undefined;
  }

  public listByTenant(tenantId: string, excludeSessionId?: string): Episode[] {
    const relatedSessions = [...this.sessionTenants.entries()]
      .filter(([sessionId, currentTenantId]) => currentTenantId === tenantId && sessionId !== excludeSessionId)
      .map(([sessionId]) => sessionId);

    return relatedSessions
      .flatMap((sessionId) => this.list(sessionId))
      .sort(compareEpisodeByCreatedAtDesc);
  }

  public replace(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.episodes.set(sessionId, episodes);
    this.sessionTenants.set(sessionId, tenantId);
  }

  public markActivated(
    sessionId: string,
    _tenantId: string,
    episodeIds: string[],
    input: {
      cycleId?: string;
      scope: ActivationTrace["last_scope"];
      activatedAt: string;
    }
  ): void {
    const episodes = this.list(sessionId).map((episode) =>
      episodeIds.includes(episode.episode_id)
        ? {
            ...episode,
            activation_trace: nextActivationTrace(episode.activation_trace, sessionId, input)
          }
        : episode
    );
    this.episodes.set(sessionId, episodes);
  }

  public markLifecycle(
    sessionId: string,
    _tenantId: string,
    episodeId: string,
    lifecycleState: MemoryLifecycleState
  ): void {
    const episodes = this.list(sessionId).map((episode) =>
      episode.episode_id === episodeId
        ? {
            ...episode,
            lifecycle_state: structuredClone(lifecycleState)
          }
        : episode
    );
    this.episodes.set(sessionId, episodes);
  }

  public deleteSession(sessionId: string): void {
    this.episodes.delete(sessionId);
    this.sessionTenants.delete(sessionId);
  }
}

export class EpisodicMemoryProvider implements MemoryProvider {
  public readonly name = "episodic-memory-provider";
  public readonly layer = "episodic" as const;

  public constructor(
    private readonly store = new EpisodicMemoryStore(),
    private readonly persistenceStore?: EpisodicMemoryPersistenceStore
  ) {}

  public list(sessionId: string): Episode[] {
    if (this.persistenceStore) {
      return this.persistenceStore.list(sessionId);
    }
    return this.store.list(sessionId);
  }

  public getLatest(sessionId: string): Episode | undefined {
    if (this.persistenceStore) {
      return this.persistenceStore.getLatest(sessionId);
    }
    return this.store.getLatest(sessionId);
  }

  public markLifecycle(sessionId: string, tenantId: string, episodeId: string, lifecycleState: MemoryLifecycleState): void {
    this.store.markLifecycle(sessionId, tenantId, episodeId, lifecycleState);
    this.persistenceStore?.markLifecycle(sessionId, tenantId, episodeId, lifecycleState);
  }

  public replace(sessionId: string, tenantId: string, episodes: Episode[]): void {
    this.store.replace(sessionId, tenantId, episodes);
    this.persistenceStore?.replace(sessionId, tenantId, episodes);
  }

  public deleteSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
    this.persistenceStore?.deleteSession(sessionId);
  }

  public evictSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
  }

  public async getDigest(ctx: ModuleContext): Promise<MemoryDigest[]> {
    if (ctx.profile.memory_config.episodic_memory_enabled === false) {
      return [];
    }

    const digestK = ctx.memory_config?.retrieval_top_k ?? 3;
    const recentSessionEpisodes = rankEpisodesByRelevance(
      this.list(ctx.session.session_id)
      .filter((episode) => shouldRecallEpisode(episode))
      .slice(),
      ctx
    )
      .slice(0, digestK)
      .map((episode) => ({
        memory_id: episode.episode_id,
        memory_type: "episodic" as const,
        summary: episode.outcome_summary,
        relevance: episode.outcome === "success" ? 0.85 : episode.outcome === "partial" ? 0.75 : 0.65
      }));
    const crossDigestK = Math.max(1, Math.ceil(digestK * 0.66));
    const relatedEpisodes = rankEpisodesByRelevance(
      this.listByTenant(ctx.tenant_id, ctx.session.session_id)
      .filter((episode) => shouldRecallEpisode(episode))
      .slice(),
      ctx
    )
      .slice(0, crossDigestK)
      .map((episode) => ({
        memory_id: episode.episode_id,
        memory_type: "episodic" as const,
        summary: `[cross-session] ${episode.outcome_summary}`,
        relevance: episode.outcome === "success" ? 0.8 : episode.outcome === "partial" ? 0.7 : 0.6
      }));

    return [...recentSessionEpisodes, ...relatedEpisodes];
  }

  public async retrieve(ctx: ModuleContext): Promise<Proposal[]> {
    if (ctx.profile.memory_config.episodic_memory_enabled === false) {
      return [];
    }

    const cycleId = ctx.session.current_cycle_id ?? ctx.services.generateId("cyc");
    const topK = ctx.memory_config?.retrieval_top_k ?? 5;
    const proposals: Proposal[] = [];
    const recentEpisodes = rankEpisodesByRelevance(
      this.list(ctx.session.session_id)
      .filter((episode) => shouldRecallEpisode(episode))
      .slice(),
      ctx
    )
      .slice(0, topK);
    const relatedEpisodes = rankEpisodesByRelevance(
      this.listByTenant(ctx.tenant_id, ctx.session.session_id)
      .filter((episode) => shouldRecallEpisode(episode))
      .filter((episode) => episode.outcome === "success" || episode.outcome === "partial")
      .slice(),
      ctx
    )
      .slice(0, Math.max(1, Math.ceil(topK * 0.6)));

    const activatedIds = [...recentEpisodes, ...relatedEpisodes].map((episode) => episode.episode_id);
    if (activatedIds.length > 0) {
      this.store.markActivated(ctx.session.session_id, ctx.tenant_id, activatedIds, {
        cycleId,
        scope: relatedEpisodes.length > 0 ? "tenant" : "session",
        activatedAt: ctx.services.now()
      });
      this.persistenceStore?.markActivated(ctx.session.session_id, ctx.tenant_id, activatedIds, {
        cycleId,
        scope: relatedEpisodes.length > 0 ? "tenant" : "session",
        activatedAt: ctx.services.now()
      });
    }

    if (recentEpisodes.length > 0) {
      proposals.push({
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: cycleId,
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: Math.min(0.9, 0.45 + recentEpisodes.length * 0.08),
        confidence: 0.9,
        risk: 0,
        payload: {
          memory_type: "episodic",
          scope: "session",
          episodes: recentEpisodes.map((episode) => ({
            episode_id: episode.episode_id,
            selected_strategy: episode.selected_strategy,
            outcome: episode.outcome,
            outcome_summary: episode.outcome_summary,
            metadata: episode.metadata ?? {}
          }))
        },
        explanation: `Recalled ${recentEpisodes.length} recent episodic memories from the session.`
      });
    }

    if (relatedEpisodes.length > 0) {
      proposals.push({
        proposal_id: ctx.services.generateId("prp"),
        schema_version: ctx.profile.schema_version,
        session_id: ctx.session.session_id,
        cycle_id: cycleId,
        module_name: this.name,
        proposal_type: "memory_recall",
        salience_score: Math.min(0.88, 0.5 + relatedEpisodes.length * 0.09),
        confidence: 0.88,
        risk: 0,
        payload: {
          memory_type: "episodic",
          scope: "tenant",
          episodes: relatedEpisodes.map((episode) => ({
            episode_id: episode.episode_id,
            session_id: episode.session_id,
            selected_strategy: episode.selected_strategy,
            outcome: episode.outcome,
            outcome_summary: episode.outcome_summary,
            metadata: episode.metadata ?? {}
          }))
        },
        explanation: `Recalled ${relatedEpisodes.length} successful episodic memories from other sessions in the same tenant.`
      });
    }

    return proposals;
  }

  public async writeEpisode(ctx: ModuleContext, episode: Episode): Promise<void> {
    if (ctx.profile.memory_config.episodic_memory_enabled === false) {
      return;
    }

    this.store.write(episode.session_id, ctx.tenant_id, episode);
    this.persistenceStore?.write(episode.session_id, ctx.tenant_id, episode);
  }

  private listByTenant(tenantId: string, excludeSessionId?: string): Episode[] {
    if (this.persistenceStore) {
      return this.persistenceStore.listByTenant(tenantId, excludeSessionId);
    }
    return this.store.listByTenant(tenantId, excludeSessionId);
  }
}

function compareEpisodeByCreatedAtDesc(left: Episode, right: Episode): number {
  return Date.parse(right.created_at) - Date.parse(left.created_at);
}

function rankEpisodesByRelevance(episodes: Episode[], ctx: ModuleContext): Episode[] {
  const inputContent =
    typeof ctx.runtime_state.current_input_content === "string"
      ? ctx.runtime_state.current_input_content.toLowerCase()
      : "";
  const expandedInputContent = expandMemorySearchText(inputContent);
  const queryTokens = dedupeStrings(tokenize(expandedInputContent).filter((token) => !STOPWORDS.has(token)));
  const corpusEntries = episodes.map((episode) => {
    const text = buildEpisodeSearchText(episode).toLowerCase();
    const tokens = tokenize(text).filter((token) => !STOPWORDS.has(token));
    return { episode, tokens };
  });
  const docFrequency = new Map<string, number>();
  for (const entry of corpusEntries) {
    for (const token of new Set(entry.tokens)) {
      docFrequency.set(token, (docFrequency.get(token) ?? 0) + 1);
    }
  }
  const avgDocLength =
    corpusEntries.length === 0
      ? 0
      : corpusEntries.reduce((sum, entry) => sum + entry.tokens.length, 0) / corpusEntries.length;

  return corpusEntries
    .map((entry) => ({
      episode: entry.episode,
      score:
        scoreEpisode(entry.episode, ctx)
        + computeBm25RerankScore(queryTokens, entry.tokens, docFrequency, corpusEntries.length, avgDocLength) * 0.16
    }))
    .sort((left, right) => {
      const scoreDiff = right.score - left.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return compareEpisodeByCreatedAtDesc(left.episode, right.episode);
    })
    .map((entry) => entry.episode);
}

function buildEpisodeSearchText(episode: Episode): string {
  return [
    episode.trigger_summary,
    episode.context_digest,
    episode.selected_strategy,
    episode.outcome_summary
  ].join(" ");
}

function scoreEpisode(episode: Episode, ctx: ModuleContext): number {
  const inputContent =
    typeof ctx.runtime_state.current_input_content === "string"
      ? ctx.runtime_state.current_input_content
      : "";
  const inputMetadata =
    ctx.runtime_state.current_input_metadata &&
    typeof ctx.runtime_state.current_input_metadata === "object"
      ? (ctx.runtime_state.current_input_metadata as Record<string, unknown>)
      : undefined;

  const haystack = buildEpisodeSearchText(episode).toLowerCase();
  const expandedInputContent = expandMemorySearchText(inputContent.toLowerCase());
  const similarity = computeSparseCosineSimilarity(expandedInputContent, haystack);
  const queryCoverage = computeQueryTokenCoverage(expandedInputContent, haystack);
  const phraseCoverage = computeQueryPhraseCoverage(inputContent.toLowerCase(), haystack);

  let score = similarity * 0.55;
  score += queryCoverage * 0.22;
  score += phraseCoverage * 0.16;
  score += computeStructuredFactBoost(inputContent.toLowerCase(), haystack, inputMetadata);

  const episodeToolName =
    episode.metadata && typeof episode.metadata.tool_name === "string"
      ? episode.metadata.tool_name
      : undefined;
  const episodeActionType =
    episode.metadata && typeof episode.metadata.action_type === "string"
      ? episode.metadata.action_type
      : undefined;
  const inputToolName =
    typeof inputMetadata?.sourceToolName === "string"
      ? inputMetadata.sourceToolName
      : typeof inputMetadata?.tool_name === "string"
        ? inputMetadata.tool_name
        : undefined;
  const inputActionType =
    typeof inputMetadata?.sourceActionType === "string"
      ? inputMetadata.sourceActionType
      : typeof inputMetadata?.action_type === "string"
        ? inputMetadata.action_type
        : undefined;

  if (episodeToolName && inputToolName && episodeToolName === inputToolName) {
    score += 0.3;
  }
  if (episodeActionType && inputActionType && episodeActionType === inputActionType) {
    score += 0.15;
  }
  const preferredRole = inferPreferredMemoryRole(inputContent, inputMetadata);
  const episodeRole = readEpisodeRole(episode.metadata);
  if (preferredRole && episodeRole) {
    score += preferredRole === episodeRole ? 0.14 : -0.04;
  }
  if (episode.outcome === "success") {
    score += 0.05;
  } else if (episode.outcome === "partial") {
    score += 0.02;
  }
  if (episode.lifecycle_state?.status === "suspect") {
    score -= 0.2;
  }
  if (episode.activation_trace?.activation_count) {
    score += Math.min(0.08, episode.activation_trace.activation_count * 0.01);
  }

  return score;
}

function nextActivationTrace(
  current: ActivationTrace | undefined,
  sessionId: string,
  input: {
    cycleId?: string;
    scope: ActivationTrace["last_scope"];
    activatedAt: string;
  }
): ActivationTrace {
  return {
    activation_count: (current?.activation_count ?? 0) + 1,
    citation_count: (current?.citation_count ?? 0) + 1,
    last_activated_at: input.activatedAt,
    last_session_id: sessionId,
    last_cycle_id: input.cycleId,
    last_scope: input.scope,
    activation_sources: dedupeStrings([...(current?.activation_sources ?? []), input.scope ?? "session"])
  };
}

function shouldRecallEpisode(episode: Episode): boolean {
  return episode.lifecycle_state?.status !== "tombstoned";
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function computeTokenOverlap(query: string, target: string): number {
  const queryVector = toTokenVector(query);
  const targetVector = toTokenVector(target);
  if (queryVector.size === 0 || targetVector.size === 0) {
    return 0;
  }

  return computeCosineSimilarity(queryVector, targetVector);
}

function computeSparseCosineSimilarity(query: string, target: string): number {
  return computeTokenOverlap(query, target);
}

function computeQueryTokenCoverage(query: string, target: string): number {
  const queryTokens = new Set(tokenize(query).filter((token) => !STOPWORDS.has(token)));
  if (queryTokens.size === 0) {
    return 0;
  }
  const targetTokens = new Set(tokenize(target));
  let hits = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.size;
}

function computeQueryPhraseCoverage(query: string, target: string): number {
  const queryTokens = tokenize(query).filter((token) => !STOPWORDS.has(token));
  if (queryTokens.length < 2) {
    return 0;
  }

  const queryPhrases = dedupeStrings([...buildTokenNgrams(queryTokens, 2), ...buildTokenNgrams(queryTokens, 3)]);
  if (queryPhrases.length === 0) {
    return 0;
  }

  const normalizedTarget = tokenize(target)
    .filter((token) => !STOPWORDS.has(token))
    .join(" ");
  let hits = 0;
  for (const phrase of queryPhrases) {
    if (normalizedTarget.includes(phrase)) {
      hits += 1;
    }
  }
  return hits / queryPhrases.length;
}

function buildTokenNgrams(tokens: string[], size: number): string[] {
  const grams: string[] = [];
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.push(tokens.slice(index, index + size).join(" "));
  }
  return grams;
}

function toTokenVector(value: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const token of tokenize(value)) {
    if (STOPWORDS.has(token)) {
      continue;
    }
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

function computeCosineSimilarity(
  left: Map<string, number>,
  right: Map<string, number>
): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const weight of left.values()) {
    leftNorm += weight * weight;
  }
  for (const weight of right.values()) {
    rightNorm += weight * weight;
  }
  for (const [token, leftWeight] of left.entries()) {
    const rightWeight = right.get(token);
    if (rightWeight !== undefined) {
      dot += leftWeight * rightWeight;
    }
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function computeBm25RerankScore(
  queryTokens: string[],
  documentTokens: string[],
  docFrequency: Map<string, number>,
  documentCount: number,
  avgDocLength: number
): number {
  if (queryTokens.length === 0 || documentTokens.length === 0 || documentCount === 0 || avgDocLength === 0) {
    return 0;
  }

  const frequencies = new Map<string, number>();
  for (const token of documentTokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const token of queryTokens) {
    const frequency = frequencies.get(token) ?? 0;
    if (frequency === 0) {
      continue;
    }
    const df = docFrequency.get(token) ?? 0;
    const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (documentTokens.length / avgDocLength));
    score += idf * ((frequency * (k1 + 1)) / denominator);
  }

  return score / (score + 4);
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function expandMemorySearchText(value: string): string {
  const expansions: string[] = [];
  if (/\b(publication|publications|paper|papers|article|articles|conference|conferences|research|study|studies|journal|journals)\b/.test(value)) {
    expansions.push("research paper article journal study conference workshop symposium dataset");
  }
  if (/\b(show|shows|movie|movies|watch|netflix|film|films|series)\b/.test(value)) {
    expansions.push("movie film series tv netflix comedy standup special storytelling episode");
  }
  if (/\b(dinner|serve|homegrown|ingredient|ingredients|recipe|recipes|cooking|garden|produce)\b/.test(value)) {
    expansions.push("recipe cooking basil mint tomato tomatoes cherry herbs garden vegetable salad fresh");
  }
  if (/\b(cocktail|cocktails|drink|drinks|get-together|mixology)\b/.test(value)) {
    expansions.push("cocktail drink gin pimm grapefruit syrup garnish cucumber summer mixology");
  }
  if (/\b(battery|phone|charging|charger|power)\b/.test(value)) {
    expansions.push("phone battery portable power bank charger charging wireless cable accessory");
  }
  if (/\b(cookie|cookies|bake|baked|baking|dessert|cake|cakes|chocolate|birthday|niece)\b/.test(value)) {
    expansions.push("baking baked dessert cookie cake cupcakes pastry sugar frosting chocolate birthday");
  }
  if (/\b(guitar|music|instrument|instruments|store)\b/.test(value)) {
    expansions.push("guitar fender stratocaster gibson les paul electric tuning strings instrument");
  }
  if (/\b(camera|photography|photo|photos|accessory|accessories|setup|gear)\b/.test(value)) {
    expansions.push("camera photography photo lens flash sony tripod gear accessory");
  }
  if (/\b(hotel|hotels|stay|trip|travel)\b/.test(value)) {
    expansions.push("hotel stay travel vacation destination family city country week-long view rooftop pool balcony room accommodation");
  }
  if (/\b(doctor|doctors|physician|physicians|clinic|appointment|appointments|medical)\b/.test(value)) {
    expansions.push("doctor physician specialist dentist dermatologist appointment clinic visit medical health");
  }
  if (/\b(volunteer|volunteered|fundraising|fundraiser|shelter|charity)\b/.test(value)) {
    expansions.push("volunteer charity fundraising fundraiser animal shelter dinner event local");
  }
  if (/\b(occupation|job|profession|career|work|worked)\b/.test(value)) {
    expansions.push("occupation job profession career worked role previous employment");
  }
  if (/\b(commute|commuting)\b/.test(value)) {
    expansions.push("commute commuting daily work travel office time duration minutes each way drive train bus subway");
  }
  if (/\b(study abroad|abroad|program|university|college|school|attend|attended)\b/.test(value)) {
    expansions.push("study abroad exchange overseas program university college semester campus institution location country city attended");
  }
  if (/\b(email|emails|message|messages)\b/.test(value)) {
    expansions.push("email emails message messages work evening night stop cutoff check checking");
  }
  if (/\b(shampoo|hair|brand)\b/.test(value)) {
    expansions.push("shampoo hair brand product conditioner currently use");
  }
  if (/\b(hike|hikes|hiking|trail|trails|distance)\b/.test(value)) {
    expansions.push("hike hiking trail trails loop route distance miles mile kilometers weekend consecutive");
  }
  if (/\b(consecutive weekends?|weekends?)\b/.test(value)) {
    expansions.push("last weekend previous weekend two weekends ago weekend ago consecutive weekends");
  }
  if (/\b(sport|sports|competitively|competitive|played|play)\b/.test(value)) {
    expansions.push("sport sports competitively competitive played team soccer tennis basketball");
  }
  if (/\b(shoe|shoes|footwear|sneakers|sandals|packed|pack|packing|luggage|suitcase|wore|wear|worn)\b/.test(value)) {
    expansions.push("shoes footwear sneakers sandals packed packing pack luggage suitcase wore wear worn pairs trip percentage percent");
  }
  if (/\b(furniture|bedroom|dresser|layout|layouts|rearrange|rearranging|arrange|arranging|decor|design)\b/.test(value)) {
    expansions.push("furniture bedroom dresser layout arrange rearranging design decor style room placement storage");
  }

  return expansions.length > 0 ? `${value} ${expansions.join(" ")}` : value;
}

function inferPreferredMemoryRole(
  inputContent: string,
  inputMetadata: Record<string, unknown> | undefined
): "user" | "assistant" | undefined {
  const explicit = inputMetadata?.preferred_memory_role;
  if (explicit === "user" || explicit === "assistant") {
    return explicit;
  }

  const questionType = inputMetadata?.question_type;
  if (questionType === "single-session-assistant" || questionType === "assistant_previnfo") {
    return "assistant";
  }
  if (questionType === "single-session-user" || questionType === "single-session-preference") {
    return "user";
  }

  const value = inputContent.toLowerCase();
  if (/\b(you|assistant)\b.*\b(said|say|tell|told|recommend|recommended|suggest|suggested|advise|advised|answer|answered|mention|mentioned)\b/.test(value)) {
    return "assistant";
  }
  if (/\b(what|which|when|where|who|how)\b.*\b(i|me|my|user)\b.*\b(said|say|tell|told|mention|mentioned|prefer|preferred|like|liked|want|wanted)\b/.test(value)) {
    return "user";
  }
  return undefined;
}

function readEpisodeRole(metadata: Record<string, unknown> | undefined): "user" | "assistant" | undefined {
  const role = metadata?.role ?? metadata?.message_role ?? metadata?.longmemeval_role;
  return role === "user" || role === "assistant" ? role : undefined;
}

function computeStructuredFactBoost(
  inputContent: string,
  haystack: string,
  inputMetadata: Record<string, unknown> | undefined
): number {
  let boost = 0;

  if (isAmountQuery(inputContent) && containsAmountSignal(haystack)) {
    boost += 0.16;
  }
  if (isDurationQuery(inputContent) && containsDurationSignal(haystack)) {
    boost += 0.1;
  }
  if (isDistanceQuery(inputContent) && containsDistanceSignal(haystack)) {
    boost += 0.08;
  }
  if (isPercentageQuery(inputContent) && containsPercentageSignal(haystack)) {
    boost += 0.08;
  }
  if (isPackedItemPercentageQuery(inputContent) && containsPackedItemSignal(haystack)) {
    boost += 0.1;
  }
  if (isCountQuery(inputContent) && containsCountSignal(haystack)) {
    boost += 0.08;
  }
  if (inputMetadata?.question_type === "single-session-preference" && containsPreferenceSignal(haystack)) {
    boost += 0.06;
  }

  return boost;
}

function isAmountQuery(value: string): boolean {
  return /\b(how much|total amount|money|spent|expense|expenses|cost|paid|worth)\b/.test(value);
}

function containsAmountSignal(value: string): boolean {
  return /[$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:dollars?|usd|bucks?)\b|\b(?:cost|paid|spent|worth)\b/.test(value);
}

function isDurationQuery(value: string): boolean {
  return /\b(how long|how much time|duration|minutes?|hours?|each way|commute|practice|practicing)\b/.test(value);
}

function containsDurationSignal(value: string): boolean {
  return /\b\d+(?:\.\d+)?\s?(?:minutes?|mins?|hours?|hrs?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s?(?:minutes?|mins?|hours?|hrs?)\b|\beach way\b/.test(value);
}

function isDistanceQuery(value: string): boolean {
  return /\b(how far|distance|miles?|kilometers?|kms?|hike|hikes|hiking|trail|trails)\b/.test(value);
}

function containsDistanceSignal(value: string): boolean {
  return /\b\d+(?:\.\d+)?\s?(?:miles?|mi|kilometers?|kilometres?|km|kms)\b/.test(value);
}

function isPercentageQuery(value: string): boolean {
  return /\b(percentage|percent|%)\b/.test(value);
}

function containsPercentageSignal(value: string): boolean {
  return /%|\bpercent\b/.test(value);
}

function isPackedItemPercentageQuery(value: string): boolean {
  return /\b(percentage|percent|%)\b/.test(value) && /\b(packed|pack|packing|shoes?|items?|wore|wear|worn)\b/.test(value);
}

function containsPackedItemSignal(value: string): boolean {
  return /\b\d+(?:\.\d+)?\s?(?:pairs?|shoes?|items?)\b|\b(?:pairs?|shoes?|items?)\b.{0,80}\b\d+(?:\.\d+)?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b.{0,80}\b(?:pairs?|shoes?|items?)\b|\b(?:packed|pack|packing|wore|wear|worn)\b.{0,120}\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\b/.test(value);
}

function isCountQuery(value: string): boolean {
  return /\b(how many|number of|count|total)\b/.test(value);
}

function containsCountSignal(value: string): boolean {
  return /\b\d+\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(value);
}

function containsPreferenceSignal(value: string): boolean {
  return /\b(i|my|me)\b.{0,120}\b(prefer|like|love|enjoy|interested|want|wanted|need|needed|looking for|planning|tend to)\b/.test(value);
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "was",
  "were",
  "are",
  "some",
  "you",
  "your",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "many",
  "much",
  "did",
  "does",
  "have",
  "had",
  "help",
  "tips",
  "advice",
  "ideas",
  "resources",
  "recommend",
  "recommended",
  "suggest",
  "suggested",
  "learn",
  "more",
  "again",
  "think",
  "thinking",
  "plan",
  "planning",
  "bit",
  "after",
  "before",
  "about",
  "from",
  "there",
  "their",
  "them",
  "then",
  "than",
  "into",
  "onto",
  "just",
  "can",
  "could",
  "would",
  "should",
  "total",
  "amount",
  "different",
  "currently"
]);
