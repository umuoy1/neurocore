import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Episode, ModuleContext, Proposal } from "@neurocore/protocol";
import {
  EpisodicMemoryProvider,
  SqliteEpisodicMemoryStore
} from "@neurocore/memory-core";

export type LongMemEvalGranularity = "session" | "turn";
export type LongMemEvalDatasetVariant =
  | "longmemeval_oracle"
  | "longmemeval_s"
  | "longmemeval_s_cleaned"
  | "longmemeval_m";

export interface LongMemEvalDatasetFile {
  variant: LongMemEvalDatasetVariant;
  filename: string;
  instances: LongMemEvalInstance[];
}

export interface LongMemEvalDatasetBundleOptions {
  requireFullBundle?: boolean;
}

export interface LongMemEvalTurn {
  role: "user" | "assistant";
  content: string;
  has_answer?: boolean;
}

export interface LongMemEvalInstance {
  question_id: string;
  question_type: string;
  question: string;
  answer: string;
  question_date: string;
  haystack_session_ids: string[];
  haystack_dates: string[];
  haystack_sessions: LongMemEvalTurn[][];
  answer_session_ids: string[];
}

export interface LongMemEvalTurnRef {
  session_id: string;
  turn_index: number;
}

export interface LongMemEvalRetrievalHit {
  rank: number;
  granularity: LongMemEvalGranularity;
  session_id: string;
  turn_index?: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface LongMemEvalRetrievalResult {
  question_id: string;
  hits: LongMemEvalRetrievalHit[];
  retrieved_session_ids: string[];
  retrieved_turn_refs: LongMemEvalTurnRef[];
}

export interface LongMemEvalPrediction {
  question_id: string;
  hypothesis: string;
}

export interface LongMemEvalQuestionReport {
  question_id: string;
  question_type: string;
  is_abstention: boolean;
  answer_session_ids: string[];
  answer_turn_refs: LongMemEvalTurnRef[];
  retrieval: LongMemEvalRetrievalResult;
  session_hit: boolean;
  session_first_relevant_rank?: number;
  turn_hit?: boolean;
  turn_first_relevant_rank?: number;
}

export interface LongMemEvalBenchmarkReport {
  benchmark: "LongMemEval";
  dataset_variant?: LongMemEvalDatasetVariant;
  source_file?: string;
  granularity: LongMemEvalGranularity;
  top_k: number;
  case_count: number;
  non_abstention_count: number;
  abstention_count: number;
  session_recall_at_k: number;
  session_mrr: number;
  turn_recall_at_k?: number;
  turn_mrr?: number;
  question_type_metrics: Record<string, LongMemEvalQuestionTypeMetrics>;
  questions: LongMemEvalQuestionReport[];
}

export interface LongMemEvalQuestionTypeMetrics {
  question_type: string;
  case_count: number;
  session_recall_at_k: number;
  session_mrr: number;
  turn_recall_at_k?: number;
  turn_mrr?: number;
}

export interface LongMemEvalBenchmarkSuiteReport {
  benchmark: "LongMemEval";
  granularity: LongMemEvalGranularity;
  top_k: number;
  reports: LongMemEvalBenchmarkReport[];
}

export interface LongMemEvalBenchmarkAggregateReport {
  benchmark: "LongMemEval";
  granularity: LongMemEvalGranularity;
  top_k: number;
  dataset_count: number;
  dataset_variants: LongMemEvalDatasetVariant[];
  case_count: number;
  non_abstention_count: number;
  abstention_count: number;
  session_recall_at_k: number;
  session_mrr: number;
  turn_recall_at_k?: number;
  turn_mrr?: number;
  question_type_metrics: Record<string, LongMemEvalQuestionTypeMetrics>;
}

export interface LongMemEvalBenchmarkMatrixRun {
  granularity: LongMemEvalGranularity;
  suite: LongMemEvalBenchmarkSuiteReport;
  aggregate: LongMemEvalBenchmarkAggregateReport;
}

export interface LongMemEvalBenchmarkMatrixReport {
  benchmark: "LongMemEval";
  top_k: number;
  runs: LongMemEvalBenchmarkMatrixRun[];
}

export interface LongMemEvalOfficialRetrievalRankedItem {
  corpus_id: string;
  text: string;
  timestamp: string;
}

export interface LongMemEvalOfficialRetrievalLogEntry {
  question_id: string;
  question_type: string;
  question: string;
  answer: string;
  question_date: string;
  haystack_dates: string[];
  haystack_sessions: LongMemEvalTurn[][];
  haystack_session_ids: string[];
  answer_session_ids: string[];
  retrieval_results: {
    query: string;
    ranked_items: LongMemEvalOfficialRetrievalRankedItem[];
    metrics: {
      session: Record<string, number>;
      turn: Record<string, number>;
    };
  };
}

export interface LongMemEvalRetriever {
  retrieve(instance: LongMemEvalInstance): Promise<LongMemEvalRetrievalResult>;
  close?(): void;
}

export interface NeuroCoreLongMemEvalRetrieverOptions {
  granularity?: LongMemEvalGranularity;
  topK?: number;
  providerRetrievalTopK?: number;
  sqliteFilename?: string;
  scopePrefix?: string;
  cleanupAfterRetrieve?: boolean;
}

export class NeuroCoreLongMemEvalRetriever implements LongMemEvalRetriever {
  private readonly granularity: LongMemEvalGranularity;
  private readonly topK: number;
  private readonly providerRetrievalTopK: number;
  private readonly sqliteFilename?: string;
  private readonly scopePrefix: string;
  private readonly cleanupAfterRetrieve: boolean;
  private readonly sqliteStore?: SqliteEpisodicMemoryStore;

  public constructor(options: NeuroCoreLongMemEvalRetrieverOptions = {}) {
    this.granularity = options.granularity ?? "session";
    this.topK = options.topK ?? 5;
    this.providerRetrievalTopK = options.providerRetrievalTopK ?? Math.max(
      this.topK,
      this.granularity === "turn" ? this.topK * 6 : this.topK * 10
    );
    this.sqliteFilename = options.sqliteFilename;
    this.scopePrefix = options.scopePrefix
      ?? `longmemeval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.cleanupAfterRetrieve = options.cleanupAfterRetrieve !== false;
    this.sqliteStore = this.sqliteFilename
      ? new SqliteEpisodicMemoryStore({ filename: this.sqliteFilename })
      : undefined;
  }

  public async retrieve(instance: LongMemEvalInstance): Promise<LongMemEvalRetrievalResult> {
    const provider = new EpisodicMemoryProvider(undefined, this.sqliteStore);
    const tenantId = `${this.scopePrefix}:${instance.question_id}`;
    const episodes = buildLongMemEvalEpisodes(instance, this.granularity);
    const questionSessionIds = dedupeStrings(episodes.map((episode) => episode.session_id));

    try {
      for (const episode of episodes) {
        await provider.writeEpisode(
          makeLongMemEvalContext({
            tenantId,
            sessionId: episode.session_id,
            question: episode.context_digest,
            retrievalTopK: this.providerRetrievalTopK,
            questionDate: instance.question_date,
            questionType: instance.question_type
          }),
          episode
        );
      }

      const proposals = await provider.retrieve(
        makeLongMemEvalContext({
          tenantId,
          sessionId: `${tenantId}:query`,
          question: instance.question,
          retrievalTopK: this.providerRetrievalTopK,
          questionDate: instance.question_date,
          questionType: instance.question_type
        })
      );

      const hits = extractLongMemEvalHits(proposals, this.granularity, this.topK);
      return {
        question_id: instance.question_id,
        hits,
        retrieved_session_ids: dedupeStrings(hits.map((hit) => hit.session_id)),
        retrieved_turn_refs: hits
          .filter((hit): hit is LongMemEvalRetrievalHit & { turn_index: number } => typeof hit.turn_index === "number")
          .map((hit) => ({
            session_id: hit.session_id,
            turn_index: hit.turn_index
          }))
      };
    } finally {
      if (this.cleanupAfterRetrieve && this.sqliteStore) {
        for (const sessionId of questionSessionIds) {
          this.sqliteStore.deleteSession(sessionId);
        }
      }
    }
  }

  public close(): void {
    this.sqliteStore?.close();
  }
}

export function loadLongMemEvalDataset(filename: string): LongMemEvalInstance[] {
  return parseLongMemEvalDataset(readFileSync(filename, "utf8"));
}

export function loadLongMemEvalDatasetBundle(
  target: string,
  options: LongMemEvalDatasetBundleOptions = {}
): LongMemEvalDatasetFile[] {
  const resolved = resolve(target);
  if (!existsSync(resolved)) {
    throw new Error(`LongMemEval dataset target does not exist: ${resolved}`);
  }

  const stat = statSync(resolved);
  if (stat.isFile()) {
    return [{
      variant: inferLongMemEvalDatasetVariant(resolved),
      filename: resolved,
      instances: loadLongMemEvalDataset(resolved)
    }];
  }

  const matchedFiles = discoverLongMemEvalDatasetFiles(resolved);
  const missingVariants = REQUIRED_LONGMEMEVAL_BUNDLE_VARIANTS
    .filter((variant) => !matchedFiles.has(variant))
    .map((variant) => variant)
    .filter((variant, index, values) => values.indexOf(variant) === index);

  if (matchedFiles.size === 0) {
    throw new Error(`No supported LongMemEval dataset files found under ${resolved}.`);
  }

  if (options.requireFullBundle && missingVariants.length > 0) {
    throw new Error(
      `LongMemEval full bundle is incomplete under ${resolved}. Missing: ${missingVariants.join(", ")}`
    );
  }

  return OFFICIAL_LONGMEMEVAL_FILENAMES
    .filter((entry) => matchedFiles.has(entry.variant))
    .map((entry) => {
      const filename = matchedFiles.get(entry.variant);
      if (!filename) {
        throw new Error(`Missing resolved filename for ${entry.variant}.`);
      }
      return {
        variant: entry.variant,
        filename,
        instances: loadLongMemEvalDataset(filename)
      };
    });
}

export function parseLongMemEvalDataset(raw: string): LongMemEvalInstance[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("LongMemEval dataset must be a JSON array.");
  }

  return parsed.map((entry, index) => normalizeLongMemEvalInstance(entry, index));
}

export function isLongMemEvalAbstention(instance: LongMemEvalInstance): boolean {
  return instance.question_id.endsWith("_abs");
}

export function collectLongMemEvalAnswerTurnRefs(instance: LongMemEvalInstance): LongMemEvalTurnRef[] {
  const refs: LongMemEvalTurnRef[] = [];

  instance.haystack_sessions.forEach((session, sessionIndex) => {
    const sessionId = instance.haystack_session_ids[sessionIndex] ?? `session_${sessionIndex}`;
    session.forEach((turn, turnIndex) => {
      if (turn.has_answer) {
        refs.push({
          session_id: sessionId,
          turn_index: turnIndex
        });
      }
    });
  });

  return refs;
}

export async function runLongMemEvalBenchmark(
  instances: LongMemEvalInstance[],
  retriever: LongMemEvalRetriever,
  options: {
    datasetVariant?: LongMemEvalDatasetVariant;
    sourceFile?: string;
    granularity?: LongMemEvalGranularity;
    topK?: number;
  } = {}
): Promise<LongMemEvalBenchmarkReport> {
  const granularity = options.granularity ?? "session";
  const topK = options.topK ?? 5;
  const questions: LongMemEvalQuestionReport[] = [];

  for (const instance of instances) {
    const retrieval = await retriever.retrieve(instance);
    const answerTurnRefs = collectLongMemEvalAnswerTurnRefs(instance);
    const sessionRanks = retrieval.hits
      .map((hit) => (instance.answer_session_ids.includes(hit.session_id) ? hit.rank : undefined))
      .filter((rank): rank is number => typeof rank === "number");
    const turnRanks = retrieval.hits
      .map((hit) => {
        if (typeof hit.turn_index !== "number") {
          return undefined;
        }
        return answerTurnRefs.some(
          (ref) => ref.session_id === hit.session_id && ref.turn_index === hit.turn_index
        )
          ? hit.rank
          : undefined;
      })
      .filter((rank): rank is number => typeof rank === "number");

    questions.push({
      question_id: instance.question_id,
      question_type: instance.question_type,
      is_abstention: isLongMemEvalAbstention(instance),
      answer_session_ids: [...instance.answer_session_ids],
      answer_turn_refs: answerTurnRefs,
      retrieval,
      session_hit: sessionRanks.length > 0,
      session_first_relevant_rank: sessionRanks[0],
      turn_hit: turnRanks.length > 0 ? true : granularity === "turn" ? false : undefined,
      turn_first_relevant_rank: turnRanks[0]
    });
  }

  const scoredQuestions = questions.filter((question) => !question.is_abstention);
  const abstentionCount = questions.length - scoredQuestions.length;
  const sessionRecallAtK =
    scoredQuestions.length === 0
      ? 1
      : scoredQuestions.filter((question) => question.session_hit).length / scoredQuestions.length;
  const sessionMrr =
    scoredQuestions.length === 0
      ? 1
      : scoredQuestions.reduce(
          (sum, question) => sum + (question.session_first_relevant_rank ? 1 / question.session_first_relevant_rank : 0),
          0
        ) / scoredQuestions.length;

  const hasTurnMetrics = granularity === "turn";
  const turnRecallAtK =
    !hasTurnMetrics || scoredQuestions.length === 0
      ? undefined
      : scoredQuestions.filter((question) => question.turn_hit).length / scoredQuestions.length;
  const turnMrr =
    !hasTurnMetrics || scoredQuestions.length === 0
      ? undefined
      : scoredQuestions.reduce(
          (sum, question) => sum + (question.turn_first_relevant_rank ? 1 / question.turn_first_relevant_rank : 0),
          0
        ) / scoredQuestions.length;

  return {
    benchmark: "LongMemEval",
    dataset_variant: options.datasetVariant,
    source_file: options.sourceFile,
    granularity,
    top_k: topK,
    case_count: questions.length,
    non_abstention_count: scoredQuestions.length,
    abstention_count: abstentionCount,
    session_recall_at_k: sessionRecallAtK,
    session_mrr: sessionMrr,
    turn_recall_at_k: turnRecallAtK,
    turn_mrr: turnMrr,
    question_type_metrics: buildQuestionTypeMetrics(scoredQuestions, hasTurnMetrics),
    questions
  };
}

export async function runLongMemEvalBenchmarkSuite(
  datasets: LongMemEvalDatasetFile[],
  retrieverFactory: (dataset: LongMemEvalDatasetFile) => LongMemEvalRetriever,
  options: {
    granularity?: LongMemEvalGranularity;
    topK?: number;
  } = {}
): Promise<LongMemEvalBenchmarkSuiteReport> {
  const reports: LongMemEvalBenchmarkReport[] = [];

  for (const dataset of datasets) {
    const retriever = retrieverFactory(dataset);
    try {
      reports.push(
        await runLongMemEvalBenchmark(dataset.instances, retriever, {
          datasetVariant: dataset.variant,
          sourceFile: dataset.filename,
          granularity: options.granularity,
          topK: options.topK
        })
      );
    } finally {
      retriever.close?.();
    }
  }

  return {
    benchmark: "LongMemEval",
    granularity: options.granularity ?? "session",
    top_k: options.topK ?? 5,
    reports
  };
}

export function aggregateLongMemEvalReports(
  reports: LongMemEvalBenchmarkReport[],
  options: {
    granularity?: LongMemEvalGranularity;
    topK?: number;
  } = {}
): LongMemEvalBenchmarkAggregateReport {
  const granularity = options.granularity ?? reports[0]?.granularity ?? "session";
  const topK = options.topK ?? reports[0]?.top_k ?? 5;
  const questions = reports.flatMap((report) => report.questions);
  const scoredQuestions = questions.filter((question) => !question.is_abstention);
  const sessionRecallAtK =
    scoredQuestions.length === 0
      ? 1
      : scoredQuestions.filter((question) => question.session_hit).length / scoredQuestions.length;
  const sessionMrr =
    scoredQuestions.length === 0
      ? 1
      : scoredQuestions.reduce(
          (sum, question) => sum + (question.session_first_relevant_rank ? 1 / question.session_first_relevant_rank : 0),
          0
        ) / scoredQuestions.length;
  const hasTurnMetrics = granularity === "turn";
  const turnRecallAtK =
    !hasTurnMetrics || scoredQuestions.length === 0
      ? undefined
      : scoredQuestions.filter((question) => question.turn_hit).length / scoredQuestions.length;
  const turnMrr =
    !hasTurnMetrics || scoredQuestions.length === 0
      ? undefined
      : scoredQuestions.reduce(
          (sum, question) => sum + (question.turn_first_relevant_rank ? 1 / question.turn_first_relevant_rank : 0),
          0
        ) / scoredQuestions.length;

  return {
    benchmark: "LongMemEval",
    granularity,
    top_k: topK,
    dataset_count: reports.length,
    dataset_variants: dedupeDatasetVariants(
      reports
        .map((report) => report.dataset_variant)
        .filter((variant): variant is LongMemEvalDatasetVariant => typeof variant === "string")
    ),
    case_count: questions.length,
    non_abstention_count: scoredQuestions.length,
    abstention_count: questions.length - scoredQuestions.length,
    session_recall_at_k: sessionRecallAtK,
    session_mrr: sessionMrr,
    turn_recall_at_k: turnRecallAtK,
    turn_mrr: turnMrr,
    question_type_metrics: buildQuestionTypeMetrics(scoredQuestions, hasTurnMetrics)
  };
}

export async function runLongMemEvalBenchmarkMatrix(
  datasets: LongMemEvalDatasetFile[],
  retrieverFactory: (dataset: LongMemEvalDatasetFile, granularity: LongMemEvalGranularity) => LongMemEvalRetriever,
  options: {
    granularities?: LongMemEvalGranularity[];
    topK?: number;
  } = {}
): Promise<LongMemEvalBenchmarkMatrixReport> {
  const topK = options.topK ?? 5;
  const granularities = dedupeGranularities(options.granularities ?? ["session", "turn"]);
  const runs: LongMemEvalBenchmarkMatrixRun[] = [];

  for (const granularity of granularities) {
    const suite = await runLongMemEvalBenchmarkSuite(
      datasets,
      (dataset) => retrieverFactory(dataset, granularity),
      { granularity, topK }
    );

    runs.push({
      granularity,
      suite,
      aggregate: aggregateLongMemEvalReports(suite.reports, { granularity, topK })
    });
  }

  return {
    benchmark: "LongMemEval",
    top_k: topK,
    runs
  };
}

export function toLongMemEvalOfficialRetrievalLog(
  instances: LongMemEvalInstance[],
  report: LongMemEvalBenchmarkReport
): LongMemEvalOfficialRetrievalLogEntry[] {
  const instanceByQuestionId = new Map(instances.map((instance) => [instance.question_id, instance]));

  return report.questions.map((question) => {
    const instance = instanceByQuestionId.get(question.question_id);
    if (!instance) {
      throw new Error(`Missing LongMemEval instance for question ${question.question_id}.`);
    }

    const rankedItems = question.retrieval.hits.map((hit) => ({
      corpus_id:
        typeof hit.turn_index === "number"
          ? `${hit.session_id}:${hit.turn_index}`
          : hit.session_id,
      text: hit.content,
      timestamp: lookupLongMemEvalSessionTimestamp(instance, hit.session_id)
    }));
    const turnRefs = question.retrieval.retrieved_turn_refs.map((ref) => `${ref.session_id}:${ref.turn_index}`);

    return {
      question_id: instance.question_id,
      question_type: instance.question_type,
      question: instance.question,
      answer: instance.answer,
      question_date: instance.question_date,
      haystack_dates: [...instance.haystack_dates],
      haystack_sessions: instance.haystack_sessions.map((session) => session.map((turn) => ({ ...turn }))),
      haystack_session_ids: [...instance.haystack_session_ids],
      answer_session_ids: [...instance.answer_session_ids],
      retrieval_results: {
        query: instance.question,
        ranked_items: rankedItems,
        metrics: {
          session: buildLongMemEvalOfficialMetrics(
            question.retrieval.retrieved_session_ids,
            instance.answer_session_ids
          ),
          turn:
            report.granularity === "turn"
              ? buildLongMemEvalOfficialMetrics(
                  turnRefs,
                  question.answer_turn_refs.map((ref) => `${ref.session_id}:${ref.turn_index}`)
                )
              : {}
        }
      }
    };
  });
}

export function toLongMemEvalOfficialRetrievalLogJsonl(
  entries: LongMemEvalOfficialRetrievalLogEntry[]
): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

export function writeLongMemEvalOfficialRetrievalLog(
  filename: string,
  entries: LongMemEvalOfficialRetrievalLogEntry[]
): void {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, toLongMemEvalOfficialRetrievalLogJsonl(entries));
}

export function toLongMemEvalPredictionsJsonl(predictions: LongMemEvalPrediction[]): string {
  return predictions
    .map((prediction) => JSON.stringify({
      question_id: prediction.question_id,
      hypothesis: prediction.hypothesis
    }))
    .join("\n");
}

export function writeLongMemEvalBenchmarkReport(
  filename: string,
  report:
    | LongMemEvalBenchmarkReport
    | LongMemEvalBenchmarkSuiteReport
    | LongMemEvalBenchmarkAggregateReport
    | LongMemEvalBenchmarkMatrixReport
): void {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, JSON.stringify(report, null, 2));
}

function normalizeLongMemEvalInstance(value: unknown, index: number): LongMemEvalInstance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`LongMemEval instance at index ${index} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const questionId = requireString(record.question_id, `question_id at index ${index}`);
  const questionType = requireString(record.question_type, `question_type for ${questionId}`);
  const question = requireString(record.question, `question for ${questionId}`);
  const answer = requireStringLike(record.answer, `answer for ${questionId}`);
  const questionDate = requireString(record.question_date, `question_date for ${questionId}`);
  const haystackSessionIds = requireStringArray(record.haystack_session_ids, `haystack_session_ids for ${questionId}`);
  const haystackDates = requireStringArray(record.haystack_dates, `haystack_dates for ${questionId}`);
  const answerSessionIds = requireStringArray(record.answer_session_ids, `answer_session_ids for ${questionId}`);
  const haystackSessions = normalizeHaystackSessions(record.haystack_sessions, questionId);

  if (haystackSessionIds.length !== haystackSessions.length || haystackDates.length !== haystackSessions.length) {
    throw new Error(`LongMemEval instance ${questionId} has mismatched haystack array lengths.`);
  }

  return {
    question_id: questionId,
    question_type: questionType,
    question,
    answer,
    question_date: questionDate,
    haystack_session_ids: haystackSessionIds,
    haystack_dates: haystackDates,
    haystack_sessions: haystackSessions,
    answer_session_ids: answerSessionIds
  };
}

function normalizeHaystackSessions(value: unknown, questionId: string): LongMemEvalTurn[][] {
  if (!Array.isArray(value)) {
    throw new Error(`haystack_sessions for ${questionId} must be an array.`);
  }

  return value.map((session, sessionIndex) => {
    if (!Array.isArray(session)) {
      throw new Error(`haystack_sessions[${sessionIndex}] for ${questionId} must be an array.`);
    }

    return session.map((turn, turnIndex) => {
      if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
        throw new Error(`turn ${turnIndex} in session ${sessionIndex} for ${questionId} must be an object.`);
      }

      const record = turn as Record<string, unknown>;
      const role = requireRole(record.role, `role at ${questionId}:${sessionIndex}:${turnIndex}`);
      const content = requireString(record.content, `content at ${questionId}:${sessionIndex}:${turnIndex}`);
      return {
        role,
        content,
        has_answer: record.has_answer === true
      };
    });
  });
}

function buildLongMemEvalEpisodes(
  instance: LongMemEvalInstance,
  granularity: LongMemEvalGranularity
): Episode[] {
  const episodes: Episode[] = [];

  instance.haystack_sessions.forEach((session, sessionIndex) => {
    const historySessionId = instance.haystack_session_ids[sessionIndex] ?? `session_${sessionIndex}`;
    const sessionDate = instance.haystack_dates[sessionIndex] ?? instance.question_date;
    const syntheticSessionId = `lme_session_${instance.question_id}_${historySessionId}`;

    if (granularity === "session") {
      const transcript = formatSessionTranscript(session);
      const sessionViews = buildLongMemEvalSessionViews(session, transcript);
      for (const view of sessionViews) {
        episodes.push({
          episode_id: `lme_episode_${instance.question_id}_${historySessionId}_${view.name}`,
          schema_version: "1.0.0",
          session_id: syntheticSessionId,
          trigger_summary: view.content.slice(0, 200) || session[0]?.content.slice(0, 200) || historySessionId,
          goal_refs: [],
          context_digest: view.content,
          selected_strategy: `longmemeval_session:${historySessionId}:${view.name}`,
          action_refs: [],
          observation_refs: [],
          outcome: "success",
          outcome_summary: view.content,
          metadata: {
            longmemeval_question_id: instance.question_id,
            longmemeval_session_id: historySessionId,
            longmemeval_granularity: granularity,
            longmemeval_view: view.name,
            longmemeval_has_answer: session.some((turn) => turn.has_answer === true),
            longmemeval_content: transcript,
            longmemeval_session_date: sessionDate
          },
          created_at: sessionDate
        });
      }
      return;
    }

    session.forEach((turn, turnIndex) => {
      const content = `${turn.role}: ${turn.content}`;
      episodes.push({
        episode_id: `lme_episode_${instance.question_id}_${historySessionId}_${turnIndex}`,
        schema_version: "1.0.0",
        session_id: syntheticSessionId,
        trigger_summary: turn.content.slice(0, 200),
        goal_refs: [],
        context_digest: content,
        selected_strategy: `longmemeval_turn:${historySessionId}:${turnIndex}`,
        action_refs: [],
        observation_refs: [],
        outcome: "success",
        outcome_summary: content,
        metadata: {
          longmemeval_question_id: instance.question_id,
          longmemeval_session_id: historySessionId,
          longmemeval_turn_index: turnIndex,
          longmemeval_granularity: granularity,
          longmemeval_role: turn.role,
          longmemeval_has_answer: turn.has_answer === true,
          longmemeval_content: content,
          longmemeval_session_date: sessionDate
        },
        created_at: sessionDate
      });
    });
  });

  return episodes;
}

function makeLongMemEvalContext(input: {
  tenantId: string;
  sessionId: string;
  question: string;
  retrievalTopK: number;
  questionDate: string;
  questionType: string;
}): ModuleContext {
  return {
    tenant_id: input.tenantId,
    session: {
      session_id: input.sessionId,
      schema_version: "1.0.0",
      tenant_id: input.tenantId,
      agent_id: "longmemeval-benchmark-agent",
      state: "running",
      session_mode: "sync",
      goal_tree_ref: "goal_tree_longmemeval",
      budget_state: {},
      policy_state: {}
    },
    profile: {
      agent_id: "longmemeval-benchmark-agent",
      schema_version: "1.0.0",
      name: "LongMemEval Benchmark Agent",
      version: "1.0.0",
      role: "benchmark",
      mode: "runtime",
      tool_refs: [],
      skill_refs: [],
      policies: { policy_ids: [] },
      memory_config: {
        working_memory_enabled: true,
        episodic_memory_enabled: true,
        semantic_memory_enabled: true,
        procedural_memory_enabled: true,
        write_policy: "immediate",
        retrieval_top_k: input.retrievalTopK
      },
      runtime_config: { max_cycles: 1 }
    },
    goals: [],
    runtime_state: {
      current_input_content: input.question,
      current_input_metadata: {
        question_date: input.questionDate,
        question_type: input.questionType,
        preferred_memory_role: inferLongMemEvalPreferredRole(input.questionType, input.question)
      }
    },
    services: {
      now: () => new Date().toISOString(),
      generateId: (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    },
    memory_config: {
      working_memory_enabled: true,
      episodic_memory_enabled: true,
      semantic_memory_enabled: true,
      procedural_memory_enabled: true,
      retrieval_top_k: input.retrievalTopK,
      write_policy: "immediate"
    }
  };
}

function extractLongMemEvalHits(
  proposals: Proposal[],
  granularity: LongMemEvalGranularity,
  topK: number
): LongMemEvalRetrievalHit[] {
  const flattened = proposals
    .filter(
      (proposal) =>
        proposal.proposal_type === "memory_recall" &&
        proposal.payload &&
        proposal.payload.memory_type === "episodic" &&
        Array.isArray(proposal.payload.episodes)
    )
    .flatMap((proposal) => proposal.payload.episodes as Array<Record<string, unknown>>);

  const hits: LongMemEvalRetrievalHit[] = [];
  const seen = new Set<string>();

  for (const rawEpisode of flattened) {
    const metadata =
      rawEpisode.metadata && typeof rawEpisode.metadata === "object" && !Array.isArray(rawEpisode.metadata)
        ? rawEpisode.metadata as Record<string, unknown>
        : {};
    const sessionId =
      typeof metadata.longmemeval_session_id === "string"
        ? metadata.longmemeval_session_id
        : typeof rawEpisode.session_id === "string"
          ? rawEpisode.session_id
          : "unknown_session";
    const turnIndex =
      typeof metadata.longmemeval_turn_index === "number"
        ? metadata.longmemeval_turn_index
        : undefined;
    const key = granularity === "turn" && typeof turnIndex === "number"
      ? `${sessionId}:${turnIndex}`
      : sessionId;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    hits.push({
      rank: hits.length + 1,
      granularity,
      session_id: sessionId,
      turn_index: turnIndex,
      content:
        typeof metadata.longmemeval_content === "string"
          ? metadata.longmemeval_content
          : typeof rawEpisode.outcome_summary === "string"
            ? rawEpisode.outcome_summary
            : "",
      metadata
    });

    if (hits.length >= topK) {
      break;
    }
  }

  return hits;
}

function inferLongMemEvalPreferredRole(
  questionType: string,
  question: string
): "user" | "assistant" | undefined {
  if (questionType === "single-session-assistant" || questionType === "assistant_previnfo") {
    return "assistant";
  }
  if (questionType === "single-session-user" || questionType === "single-session-preference") {
    return "user";
  }

  const normalized = question.toLowerCase();
  if (/\b(you|assistant)\b.*\b(said|say|told|recommend|recommended|suggest|suggested|advise|advised|answer|answered)\b/.test(normalized)) {
    return "assistant";
  }
  if (/\b(i|me|my)\b.*\b(said|say|told|mention|mentioned|prefer|preferred|like|liked|want|wanted)\b/.test(normalized)) {
    return "user";
  }
  return undefined;
}

function formatSessionTranscript(session: LongMemEvalTurn[]): string {
  return session
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join("\n");
}

function buildLongMemEvalSessionViews(
  session: LongMemEvalTurn[],
  transcript: string
): Array<{ name: string; content: string }> {
  const userTurns = session.filter((turn) => turn.role === "user");
  const assistantTurns = session.filter((turn) => turn.role === "assistant");
  const preferenceTurns = userTurns.filter((turn) =>
    /\b(prefer|like|love|enjoy|interested|want|wanted|need|needed|looking for|planning|tend to)\b/i.test(turn.content)
  );
  const factTurns = session.filter((turn) =>
    /[$€£]\s?\d|\b\d+(?:\.\d+)?\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(turn.content)
  );
  const views = [
    { name: "full", content: transcript },
    { name: "user", content: formatSessionTranscript(userTurns) },
    { name: "assistant", content: formatSessionTranscript(assistantTurns) },
    { name: "lead-user", content: formatSessionTranscript(userTurns.slice(0, 3)) },
    { name: "preference", content: formatSessionTranscript(preferenceTurns) },
    { name: "fact", content: formatSessionTranscript(factTurns) }
  ];

  return views.filter((view) => view.content.trim().length > 0);
}

function lookupLongMemEvalSessionTimestamp(
  instance: LongMemEvalInstance,
  sessionId: string
): string {
  const index = instance.haystack_session_ids.indexOf(sessionId);
  if (index === -1) {
    return instance.question_date;
  }
  return instance.haystack_dates[index] ?? instance.question_date;
}

function buildLongMemEvalOfficialMetrics(
  rankedCorpusIds: string[],
  correctCorpusIds: string[]
): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const k of [1, 3, 5, 10, 30, 50]) {
    const rankedWindow = rankedCorpusIds.slice(0, k);
    const hits = rankedWindow.filter((corpusId) => correctCorpusIds.includes(corpusId));
    metrics[`recall_any@${k}`] = hits.length > 0 ? 1 : 0;
    metrics[`recall_all@${k}`] =
      correctCorpusIds.length === 0
        ? 1
        : correctCorpusIds.every((corpusId) => rankedWindow.includes(corpusId))
          ? 1
          : 0;
    metrics[`ndcg_any@${k}`] = computeLongMemEvalNdcg(rankedWindow, correctCorpusIds);
  }

  return metrics;
}

function computeLongMemEvalNdcg(
  rankedCorpusIds: string[],
  correctCorpusIds: string[]
): number {
  if (correctCorpusIds.length === 0 || rankedCorpusIds.length === 0) {
    return correctCorpusIds.length === 0 ? 1 : 0;
  }

  const dcg = rankedCorpusIds.reduce((sum, corpusId, index) => {
    if (!correctCorpusIds.includes(corpusId)) {
      return sum;
    }
    return sum + (1 / Math.log2(index + 2));
  }, 0);
  const idealHitCount = Math.min(correctCorpusIds.length, rankedCorpusIds.length);
  const idealDcg = Array.from({ length: idealHitCount }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((sum, value) => sum + value, 0);

  if (idealDcg === 0) {
    return 0;
  }

  return dcg / idealDcg;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected ${label} to be a string.`);
  }
  return value;
}

function requireStringLike(value: unknown, label: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`Expected ${label} to be a string-like value.`);
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an array of strings.`);
  }
  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireRole(value: unknown, label: string): LongMemEvalTurn["role"] {
  if (value === "user" || value === "assistant") {
    return value;
  }
  throw new Error(`Expected ${label} to be "user" or "assistant".`);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function dedupeGranularities(values: LongMemEvalGranularity[]): LongMemEvalGranularity[] {
  const seen = new Set<LongMemEvalGranularity>();
  const result: LongMemEvalGranularity[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function dedupeDatasetVariants(values: LongMemEvalDatasetVariant[]): LongMemEvalDatasetVariant[] {
  const seen = new Set<LongMemEvalDatasetVariant>();
  const result: LongMemEvalDatasetVariant[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function buildQuestionTypeMetrics(
  questions: LongMemEvalQuestionReport[],
  hasTurnMetrics: boolean
): Record<string, LongMemEvalQuestionTypeMetrics> {
  const grouped = new Map<string, LongMemEvalQuestionReport[]>();
  for (const question of questions) {
    const current = grouped.get(question.question_type) ?? [];
    current.push(question);
    grouped.set(question.question_type, current);
  }

  return Object.fromEntries(
    [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([questionType, entries]) => {
      const sessionRecallAtK = entries.filter((entry) => entry.session_hit).length / entries.length;
      const sessionMrr = entries.reduce(
        (sum, entry) => sum + (entry.session_first_relevant_rank ? 1 / entry.session_first_relevant_rank : 0),
        0
      ) / entries.length;
      const turnRecallAtK = hasTurnMetrics
        ? entries.filter((entry) => entry.turn_hit).length / entries.length
        : undefined;
      const turnMrr = hasTurnMetrics
        ? entries.reduce(
            (sum, entry) => sum + (entry.turn_first_relevant_rank ? 1 / entry.turn_first_relevant_rank : 0),
            0
          ) / entries.length
        : undefined;

      return [
        questionType,
        {
          question_type: questionType,
          case_count: entries.length,
          session_recall_at_k: sessionRecallAtK,
          session_mrr: sessionMrr,
          turn_recall_at_k: turnRecallAtK,
          turn_mrr: turnMrr
        }
      ];
    })
  );
}

function inferLongMemEvalDatasetVariant(filename: string): LongMemEvalDatasetVariant {
  const matched = matchLongMemEvalDatasetFile(filename);
  if (matched) {
    return matched.variant;
  }
  return "longmemeval_oracle";
}

function discoverLongMemEvalDatasetFiles(root: string): Map<LongMemEvalDatasetVariant, string> {
  const matched = new Map<LongMemEvalDatasetVariant, string>();
  const pending = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current)) {
      const filename = join(current, entry);
      const stat = statSync(filename);
      if (stat.isDirectory()) {
        pending.push(filename);
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }

      const variant = tryInferLongMemEvalDatasetVariant(filename);
      if (!variant) {
        continue;
      }

      const existing = matched.get(variant);
      if (existing && existing !== filename) {
        throw new Error(
          `Multiple LongMemEval files found for ${variant}: ${existing} and ${filename}`
        );
      }
      matched.set(variant, filename);
    }
  }

  return matched;
}

function tryInferLongMemEvalDatasetVariant(filename: string): LongMemEvalDatasetVariant | undefined {
  const matched = matchLongMemEvalDatasetFile(filename);
  return matched?.variant;
}

const OFFICIAL_LONGMEMEVAL_FILENAMES: Array<{
  variant: LongMemEvalDatasetVariant;
  filenames: string[];
}> = [
  { variant: "longmemeval_oracle", filenames: ["longmemeval_oracle.json"] },
  { variant: "longmemeval_s_cleaned", filenames: ["longmemeval_s_cleaned.json"] },
  { variant: "longmemeval_s", filenames: ["longmemeval_s.json"] },
  { variant: "longmemeval_m", filenames: ["longmemeval_m.json", "longmemeval_m_cleaned.json"] }
];

const REQUIRED_LONGMEMEVAL_BUNDLE_VARIANTS: LongMemEvalDatasetVariant[] = [
  "longmemeval_oracle",
  "longmemeval_s_cleaned",
  "longmemeval_m"
];

function matchLongMemEvalDatasetFile(filename: string): {
  variant: LongMemEvalDatasetVariant;
  filename: string;
} | undefined {
  const lower = filename.toLowerCase();
  for (const entry of OFFICIAL_LONGMEMEVAL_FILENAMES) {
    for (const candidate of entry.filenames) {
      if (lower.endsWith(candidate)) {
        return {
          variant: entry.variant,
          filename: candidate
        };
      }
    }
  }

  return undefined;
}
