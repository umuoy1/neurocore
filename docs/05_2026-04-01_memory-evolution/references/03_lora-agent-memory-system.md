# 用 LoRA 实现 Agent 记忆系统

## 一、核心思路

```
┌─────────────────────────────────────────────────────────┐
│                Agent 记忆系统架构                          │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐             │
│  │ 短期记忆  │   │ 中期记忆  │   │ 长期记忆  │             │
│  │ Context  │   │  RAG     │   │  LoRA    │             │
│  │ Window   │   │ 向量检索  │   │ 权重固化  │             │
│  ├──────────┤   ├──────────┤   ├──────────┤             │
│  │ 当前对话  │   │ 历史文档  │   │ 行为模式  │             │
│  │ ~128K    │   │ 可扩展   │   │ 永久保存  │              │
│  │ 会话结束  │   │ 检索延迟  │   │ 零延迟   │              │
│  │ 即丢失   │   │ 可能遗漏  │   │ 内化知识  │              │
│  └──────────┘   └──────────┘   └──────────┘             │
│       ↑               ↑              ↑                   │
│       │               │              │                   │
│    即时性强         灵活可更新      深度内化                 │
│    容量有限         依赖检索质量    训练成本高                │
└─────────────────────────────────────────────────────────┘
```

## 二、LoRA 作为长期记忆的可行性分析

```
┌────────────────┬──────────┬──────────┬──────────────────┐
│    记忆类型     │  能否用   │  效果    │  说明             │
│                │  LoRA    │         │                   │
├────────────────┼──────────┼──────────┼──────────────────┤
│ 用户偏好/风格   │  ✅ 适合  │  ⭐⭐⭐⭐ │ 语气、格式、习惯    │
│ 领域知识       │  ✅ 适合  │  ⭐⭐⭐⭐ │ 专业术语、流程      │
│ 行为模式       │  ✅ 适合  │  ⭐⭐⭐⭐ │ 决策倾向、工具使用   │
│ 精确事实       │  ⚠️ 一般  │  ⭐⭐    │ 电话号码、日期等    │
│ 实时信息       │  ❌ 不适  │  ⭐     │ 需要RAG           │
│ 单次事件细节    │  ❌ 不适  │  ⭐     │ 需要外部存储       │
└────────────────┴──────────┴──────────┴──────────────────┘

结论：LoRA 适合记忆"模式"，不适合记忆"事实"
     最佳方案 = LoRA（长期模式） + RAG（事实检索） + Context（即时）
```

## 三、完整架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                    Agent 记忆系统全景                          │
│                                                               │
│  用户输入 ──→ ┌─────────────────────────────────┐             │
│              │        记忆路由器                  │             │
│              │   Memory Router                  │             │
│              └──┬──────────┬──────────┬──────────┘             │
│                 │          │          │                        │
│                 ▼          ▼          ▼                        │
│  ┌──────────────┐ ┌───────────┐ ┌─────────────┐              │
│  │  工作记忆     │ │  情景记忆   │ │  程序记忆    │              │
│  │  Working     │ │  Episodic  │ │  Procedural │              │
│  │              │ │            │ │             │              │
│  │ • 当前上下文  │ │ • 向量数据库│ │ • LoRA 权重  │              │
│  │ • 思维链     │ │ • 对话历史  │ │ • 用户适配器  │              │
│  │ • 工具状态   │ │ • 事件日志  │ │ • 领域适配器  │              │
│  │              │ │ • 知识图谱  │ │ • 行为适配器  │              │
│  └──────┬───────┘ └─────┬─────┘ └──────┬──────┘              │
│         │               │              │                      │
│         └───────────────┼──────────────┘                      │
│                         ▼                                     │
│              ┌─────────────────────┐                          │
│              │   LLM 基座模型       │                          │
│              │   + 动态 LoRA 加载   │                          │
│              └─────────────────────┘                          │
│                         │                                     │
│                         ▼                                     │
│                    Agent 输出                                  │
└──────────────────────────────────────────────────────────────┘
```

## 四、核心实现

### 1. 记忆管理器

```python
import torch
import json
import time
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from enum import Enum


class MemoryType(Enum):
    WORKING = "working"
    EPISODIC = "episodic"
    PROCEDURAL = "procedural"


@dataclass
class MemoryEntry:
    content: str
    memory_type: MemoryType
    timestamp: float = field(default_factory=time.time)
    importance: float = 0.5
    access_count: int = 0
    metadata: dict = field(default_factory=dict)


@dataclass
class LoRAMemoryConfig:
    rank: int = 8
    alpha: float = 16.0
    target_modules: List[str] = field(
        default_factory=lambda: ["q_proj", "v_proj"]
    )
    consolidation_threshold: int = 50
    learning_rate: float = 2e-4
    consolidation_epochs: int = 3
    adapter_save_dir: str = "./memory_adapters"


class AgentMemorySystem:
    """
    Agent 三层记忆系统

    短期 → 中期 → 长期 的记忆流转：

    对话交互 → 工作记忆 → 重要内容存入情景记忆
                              ↓
                        积累足够模式
                              ↓
                     LoRA 训练固化为长期记忆
    """

    def __init__(self, base_model, tokenizer, vector_store, lora_config=None):
        self.base_model = base_model
        self.tokenizer = tokenizer
        self.vector_store = vector_store
        self.config = lora_config or LoRAMemoryConfig()
        self.working_memory: List[MemoryEntry] = []
        self.consolidation_buffer: List[dict] = []
        self.active_adapters: Dict[str, str] = {}
        self.memory_index = self._load_memory_index()

    def remember(self, content, memory_type, importance=0.5, metadata=None):
        entry = MemoryEntry(
            content=content, memory_type=memory_type,
            importance=importance, metadata=metadata or {},
        )

        if memory_type == MemoryType.WORKING:
            self._add_to_working_memory(entry)
        elif memory_type == MemoryType.EPISODIC:
            self._add_to_episodic_memory(entry)

        if importance > 0.7:
            self.consolidation_buffer.append({
                "content": content, "timestamp": entry.timestamp,
                "importance": importance, "metadata": metadata,
            })
            if len(self.consolidation_buffer) >= self.config.consolidation_threshold:
                self._trigger_consolidation()

    def _add_to_working_memory(self, entry):
        self.working_memory.append(entry)
        if len(self.working_memory) > 20:
            self.working_memory.sort(key=lambda e: (e.importance, e.timestamp))
            removed = self.working_memory.pop(0)
            if removed.importance > 0.5:
                self._add_to_episodic_memory(removed)

    def _add_to_episodic_memory(self, entry):
        self.vector_store.add(
            text=entry.content,
            metadata={"timestamp": entry.timestamp, "importance": entry.importance, **entry.metadata},
        )

    def recall(self, query, top_k=5):
        return {
            "working": self._search_working_memory(query),
            "episodic": self.vector_store.search(query=query, top_k=top_k),
            "procedural": list(self.active_adapters.keys()),
        }

    def build_memory_augmented_prompt(self, user_query):
        memories = self.recall(user_query)
        prompt_parts = [
            "You are an AI assistant with persistent memory. "
            "Use the following memories to provide personalized responses."
        ]
        if memories["episodic"]:
            prompt_parts.append("\n## Relevant Past Interactions:")
            for i, mem in enumerate(memories["episodic"], 1):
                prompt_parts.append(f"  {i}. {mem['text']}")
        if memories["working"]:
            prompt_parts.append("\n## Current Session Context:")
            for mem in memories["working"]:
                prompt_parts.append(f"  - {mem}")
        if memories["procedural"]:
            prompt_parts.append(f"\n## Active Adaptations: {', '.join(memories['procedural'])}")
        prompt_parts.append(f"\n## User Query:\n{user_query}")
        return "\n".join(prompt_parts)
```

### 2. LoRA 记忆固化（核心）

```python
class LoRAMemoryConsolidator:
    """
    记忆固化器：将积累的经验通过 LoRA 训练固化为长期记忆

    类比人类睡眠时的记忆巩固过程：

    白天经历（情景记忆）
         ↓ 睡眠/离线处理
    提取模式 → 构建训练数据
         ↓
    LoRA 微调（固化到权重）
         ↓
    长期程序记忆（自动化行为）
    """

    def __init__(self, base_model, tokenizer, config):
        self.base_model = base_model
        self.tokenizer = tokenizer
        self.config = config
        self.adapter_registry = {}
        Path(config.adapter_save_dir).mkdir(parents=True, exist_ok=True)

    def consolidate(self, memory_buffer, adapter_name, adapter_type="user_preference"):
        training_data = self._memories_to_training_data(memory_buffer, adapter_type)
        dataset = self._build_dataset(training_data)
        adapter_path = self._train_lora(dataset=dataset, adapter_name=adapter_name)

        self.adapter_registry[adapter_name] = {
            "path": adapter_path, "type": adapter_type,
            "created_at": time.time(), "memory_count": len(memory_buffer),
            "config": {"rank": self.config.rank, "alpha": self.config.alpha},
        }
        self._save_registry()
        return adapter_path

    def _memories_to_training_data(self, memories, adapter_type):
        converters = {
            "user_preference": self._convert_preference_memories,
            "domain_knowledge": self._convert_knowledge_memories,
            "behavior_pattern": self._convert_behavior_memories,
            "conversation_style": self._convert_style_memories,
        }
        return converters.get(adapter_type, lambda m: [])(memories)

    def _convert_preference_memories(self, memories):
        data = []
        for mem in memories:
            content = mem["content"]
            metadata = mem.get("metadata", {})
            if "user_query" in metadata and "preferred_response" in metadata:
                data.append({
                    "instruction": metadata["user_query"],
                    "output": metadata["preferred_response"],
                })
            if "preference" in metadata:
                data.append({
                    "instruction": f"What does the user prefer regarding {metadata.get('topic', 'this')}?",
                    "output": f"The user prefers: {metadata['preference']}. {content}",
                })
            if "conversation" in metadata:
                conv = metadata["conversation"]
                data.append({
                    "instruction": conv.get("user", content),
                    "output": conv.get("assistant", ""),
                })
        return data

    def _convert_knowledge_memories(self, memories):
        data = []
        for mem in memories:
            content = mem["content"]
            data.append({
                "instruction": f"Explain the following concept: {content[:50]}...",
                "output": content,
            })
        return data

    def _convert_behavior_memories(self, memories):
        data = []
        for mem in memories:
            metadata = mem.get("metadata", {})
            if "situation" in metadata and "action" in metadata:
                data.append({
                    "instruction": f"Given the situation: {metadata['situation']}\nWhat action should be taken?",
                    "output": f"Based on past experience, the recommended action is: {metadata['action']}\nReasoning: {mem['content']}",
                })
        return data

    def _convert_style_memories(self, memories):
        data = []
        for mem in memories:
            metadata = mem.get("metadata", {})
            if "user_message" in metadata and "ideal_response" in metadata:
                data.append({
                    "instruction": metadata["user_message"],
                    "output": metadata["ideal_response"],
                })
        return data

    def _train_lora(self, dataset, adapter_name):
        from peft import LoraConfig, get_peft_model, TaskType
        from torch.utils.data import DataLoader

        peft_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM, r=self.config.rank,
            lora_alpha=self.config.alpha, lora_dropout=0.05,
            target_modules=self.config.target_modules,
        )
        model = get_peft_model(self.base_model, peft_config)
        model.train()

        dataloader = DataLoader(dataset, batch_size=4, shuffle=True)
        optimizer = torch.optim.AdamW(
            filter(lambda p: p.requires_grad, model.parameters()),
            lr=self.config.learning_rate,
        )

        for epoch in range(self.config.consolidation_epochs):
            total_loss = 0
            for batch in dataloader:
                input_ids = batch["input_ids"].to(model.device)
                attention_mask = batch["attention_mask"].to(model.device)
                labels = batch["labels"].to(model.device)
                outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
                loss = outputs.loss
                loss.backward()
                optimizer.step()
                optimizer.zero_grad()
                total_loss += loss.item()

        save_path = f"{self.config.adapter_save_dir}/{adapter_name}"
        model.save_pretrained(save_path)
        return save_path
```

### 3. 动态 LoRA 加载器

```python
from peft import PeftModel


class DynamicLoRALoader:
    """
    动态 LoRA 适配器加载器 — 根据用户/场景动态切换记忆适配器

    ┌─────────────────────────────────────────┐
    │           适配器池                        │
    │                                          │
    │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
    │  │ user_A  │ │ user_B  │ │ domain  │   │
    │  │ r=8     │ │ r=8     │ │ r=16    │   │
    │  │ 偏好    │ │ 偏好    │ │ 医疗    │    │
    │  └────┬────┘ └────┬────┘ └────┬────┘   │
    │       └───────────┼───────────┘         │
    │                   ▼                     │
    │    ┌──────────────────────────────┐     │
    │    │     LoRA Adapter Merger      │     │
    │    └──────────────────────────────┘     │
    │                   ▼                     │
    │    ┌──────────────────────────────┐     │
    │    │       Base Model             │     │
    │    └──────────────────────────────┘     │
    └─────────────────────────────────────────┘
    """

    def __init__(self, base_model, adapter_dir="./memory_adapters"):
        self.base_model = base_model
        self.adapter_dir = adapter_dir
        self.loaded_adapters = {}
        self.current_model = base_model
        registry_path = f"{adapter_dir}/registry.json"
        self.registry = json.load(open(registry_path)) if Path(registry_path).exists() else {}

    def load_adapter(self, adapter_name, weight=1.0):
        adapter_path = self.registry[adapter_name]["path"]
        if not self.loaded_adapters:
            self.current_model = PeftModel.from_pretrained(
                self.base_model, adapter_path, adapter_name=adapter_name,
            )
        else:
            self.current_model.load_adapter(adapter_path, adapter_name=adapter_name)
        self.loaded_adapters[adapter_name] = True

    def switch_adapter(self, adapter_name):
        if adapter_name not in self.loaded_adapters:
            self.load_adapter(adapter_name)
        self.current_model.set_adapter(adapter_name)

    def merge_adapters(self, adapter_names, weights=None):
        if weights is None:
            weights = [1.0 / len(adapter_names)] * len(adapter_names)
        for name in adapter_names:
            if name not in self.loaded_adapters:
                self.load_adapter(name)
        self.current_model.add_weighted_adapter(
            adapters=adapter_names, weights=weights,
            adapter_name="merged_memory", combination_type="linear",
        )
        self.current_model.set_adapter("merged_memory")

    def get_model(self):
        return self.current_model
```

### 4. 完整 Agent 集成

```python
class MemoryAugmentedAgent:
    """
    带记忆系统的完整 Agent

    生命周期：
    1. 初始化 → 加载基座模型 + 历史 LoRA 适配器
    2. 对话中 → 工作记忆 + RAG 检索 + LoRA 推理
    3. 对话后 → 重要记忆存入情景记忆
    4. 定期   → 触发记忆固化（LoRA 训练）
    5. 下次   → 自动加载对应用户的 LoRA 适配器
    """

    def __init__(self, model_name):
        self.base_model = AutoModelForCausalLM.from_pretrained(
            model_name, torch_dtype=torch.bfloat16, device_map="auto"
        )
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.memory = AgentMemorySystem(
            base_model=self.base_model, tokenizer=self.tokenizer,
            vector_store=SimpleVectorStore(),
            lora_config=LoRAMemoryConfig(rank=8, consolidation_threshold=50),
        )
        self.lora_loader = DynamicLoRALoader(self.base_model)
        self.consolidator = LoRAMemoryConsolidator(
            self.base_model, self.tokenizer, self.memory.config,
        )
        self.importance_evaluator = MemoryImportanceEvaluator()

    def start_session(self, user_id):
        adapter_name = f"user_{user_id}"
        available = self.lora_loader.list_available_adapters()
        if any(a["name"] == adapter_name for a in available):
            self.lora_loader.load_adapter(adapter_name)
        self.memory.working_memory.clear()

    def chat(self, user_message):
        self.memory.remember(content=user_message, memory_type=MemoryType.WORKING, importance=0.5)
        augmented_prompt = self.memory.build_memory_augmented_prompt(user_message)
        model = self.lora_loader.get_model()
        response = self._generate(model, augmented_prompt)

        importance = self.importance_evaluator.evaluate(user_message, response)
        if importance > 0.6:
            self.memory.remember(
                content=f"User: {user_message}\nAssistant: {response}",
                memory_type=MemoryType.EPISODIC, importance=importance,
                metadata={
                    "user_query": user_message, "preferred_response": response,
                    "conversation": {"user": user_message, "assistant": response},
                },
            )
        self.memory.remember(content=f"Assistant: {response}", memory_type=MemoryType.WORKING, importance=0.3)
        return response

    def end_session(self, user_id):
        buffer = self.memory.consolidation_buffer
        if len(buffer) >= self.memory.config.consolidation_threshold:
            self.consolidator.consolidate(
                memory_buffer=buffer, adapter_name=f"user_{user_id}",
                adapter_type="user_preference",
            )
            self.memory.consolidation_buffer.clear()


class MemoryImportanceEvaluator:
    def evaluate(self, user_message, response):
        score = 0.3
        msg_lower = user_message.lower()

        preference_keywords = ["我喜欢", "我不喜欢", "我偏好", "i like", "i prefer", "请记住", "remember", "always", "never"]
        if any(kw in msg_lower for kw in preference_keywords):
            score += 0.3

        correction_keywords = ["不对", "错了", "不是这样", "wrong", "incorrect", "actually"]
        if any(kw in msg_lower for kw in correction_keywords):
            score += 0.25

        personal_keywords = ["我的名字", "我是", "my name", "i am", "i work"]
        if any(kw in msg_lower for kw in personal_keywords):
            score += 0.2

        memory_keywords = ["记住", "别忘了", "remember this", "keep in mind"]
        if any(kw in msg_lower for kw in memory_keywords):
            score += 0.4

        return min(score, 1.0)
```

### 5. 使用示例

```python
agent = MemoryAugmentedAgent("meta-llama/Llama-2-7b-hf")

agent.start_session("alice")
agent.chat("我叫 Alice，我是一名数据科学家")
agent.chat("我喜欢用 Python，不喜欢 Java")
agent.chat("请用简洁的风格回答我，不要太啰嗦")
agent.end_session("alice")

agent.start_session("alice")
response = agent.chat("帮我写个数据处理脚本")

agent.lora_loader.merge_adapters(
    adapter_names=["user_alice", "domain_medical"],
    weights=[0.7, 0.3],
)
```

## 五、记忆生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                    记忆生命周期                                │
│                                                              │
│  用户交互                                                     │
│    │                                                         │
│    ▼                                                         │
│  ┌──────────┐   重要性 > 0.5    ┌──────────┐                │
│  │ 工作记忆  │ ───────────────→  │ 情景记忆  │                │
│  │ (即时)   │   溢出/会话结束    │ (向量DB) │                 │
│  └──────────┘                   └────┬─────┘                │
│                                      │                       │
│                               积累足够模式                    │
│                               (≥50条高重要性)                 │
│                                      │                       │
│                                      ▼                       │
│                            ┌──────────────────┐             │
│                            │   记忆固化引擎     │             │
│                            │  1. 提取模式      │              │
│                            │  2. 构建训练数据   │              │
│                            │  3. LoRA 微调     │              │
│                            │  4. 保存适配器    │               │
│                            └────────┬─────────┘             │
│                                     │                        │
│                                     ▼                        │
│                            ┌──────────────────┐             │
│                            │   程序记忆         │             │
│                            │   (LoRA 权重)     │              │
│                            │  • 用户偏好适配器  │              │
│                            │  • 领域知识适配器  │              │
│                            │  • 行为模式适配器  │              │
│                            └──────────────────┘             │
│                                     │                        │
│                              下次会话自动加载                  │
└─────────────────────────────────────────────────────────────┘
```

## 六、方案对比与选型建议

```
┌──────────────┬──────────────┬──────────────┬───────────────┐
│              │  纯 RAG      │  纯 LoRA     │  混合方案 ⭐   │
├──────────────┼──────────────┼──────────────┼───────────────┤
│ 精确事实记忆  │  ✅ 强       │  ❌ 弱       │  ✅ RAG 负责   │
│ 行为模式     │  ⚠️ 一般     │  ✅ 强       │  ✅ LoRA 负责  │
│ 用户风格     │  ⚠️ 需提示   │  ✅ 内化     │  ✅ LoRA 负责  │
│ 推理延迟     │  ⚠️ 检索开销  │  ✅ 零开销   │  ✅ 均衡      │
│ 存储成本     │  ⚠️ 向量库大  │  ✅ 适配器小  │  ✅ 互补      │
│ 更新灵活性   │  ✅ 即时更新  │  ⚠️ 需重训   │  ✅ 分层更新   │
│ 可解释性     │  ✅ 可溯源   │  ❌ 黑盒     │  ⚠️ 部分可解释 │
│ 多用户隔离   │  ✅ 命名空间  │  ✅ 独立适配器│  ✅ 完全隔离   │
│ 冷启动       │  ✅ 无需训练  │  ❌ 需数据   │  ✅ RAG 先行   │
├──────────────┼──────────────┼──────────────┼───────────────┤
│ 推荐场景     │  知识密集型   │  个性化服务   │  生产级 Agent  │
└──────────────┴──────────────┴──────────────┴───────────────┘
```

> **核心结论**：LoRA 可以作为 Agent 长期记忆的重要组件，但不应是唯一方案。最佳实践是 **三层记忆架构**：工作记忆（Context）+ 情景记忆（RAG）+ 程序记忆（LoRA），各司其职，协同工作。
