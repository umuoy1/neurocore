# LoRA 秩微调（Low-Rank Adaptation）

## 一、核心概念

```
原始权重矩阵 W (d×d)
         ↓
冻结 W，添加低秩分解：ΔW = A × B

W' = W + ΔW = W + A·B

其中：A ∈ R^(d×r), B ∈ R^(r×d), r << d
```

```
┌─────────────────────────────────────────────┐
│           原始预训练模型                       │
│                                              │
│   输入 x ──→ [W (冻结)] ──────→ (+) ──→ 输出  │
│              │                  ↑             │
│              └──→ [A]·[B] ─────┘             │
│                   (可训练)                     │
│                   r = 秩                      │
└─────────────────────────────────────────────┘
```

## 二、秩（Rank）的作用

```
参数量对比：

原始微调：  d × d = d² 个参数
LoRA微调：  d × r + r × d = 2dr 个参数

例：d = 4096, r = 8
原始：4096² = 16,777,216 参数
LoRA：2 × 4096 × 8 = 65,536 参数  (仅 0.39%)
```

### 秩的选择对比

```
┌──────────┬──────────┬───────────┬───────────┬──────────────┐
│   秩 r   │  参数量   │  表达能力  │  训练速度  │   适用场景    │
├──────────┼──────────┼───────────┼───────────┼──────────────┤
│  r = 1   │  最少     │  很弱     │  最快      │  极简单任务   │
│  r = 4   │  很少     │  较弱     │  很快      │  风格迁移     │
│  r = 8   │  少      │  适中     │  快        │  通用微调 ⭐  │
│  r = 16  │  适中     │  较强     │  适中      │  复杂任务     │
│  r = 32  │  较多     │  强      │  较慢      │  多领域适配   │
│  r = 64  │  多      │  很强     │  慢        │  高精度需求   │
│  r = 128 │  很多     │  极强     │  很慢      │  接近全量微调  │
└──────────┴──────────┴───────────┴───────────┴──────────────┘
```

## 三、数学原理

```python
def lora_forward(x, W_frozen, A, B, alpha, r):
    """
    x:        输入向量
    W_frozen: 冻结的原始权重 (d_out × d_in)
    A:        低秩矩阵A (d_out × r)  — 通常用高斯初始化
    B:        低秩矩阵B (r × d_in)   — 通常初始化为零
    alpha:    缩放因子
    r:        秩
    """
    h = W_frozen @ x
    scaling = alpha / r
    delta_h = A @ B @ x
    output = h + scaling * delta_h
    return output
```

### 缩放因子 alpha

```
实际增量 = (alpha / r) × A × B × x

┌────────────────────────────────────────────┐
│  alpha 的作用：                              │
│                                             │
│  • alpha = r  → 缩放系数 = 1（标准）         │
│  • alpha = 2r → 缩放系数 = 2（放大LoRA影响）  │
│  • alpha = r/2→ 缩放系数 = 0.5（缩小影响）    │
│                                             │
│  通常固定 alpha，只调 r                       │
│  常见设置：alpha = 16, 32                    │
└────────────────────────────────────────────┘
```

## 四、PyTorch 实现

### 1. LoRA 层实现

```python
import torch
import torch.nn as nn
import math


class LoRALayer(nn.Module):
    def __init__(
        self,
        in_features: int,
        out_features: int,
        rank: int = 8,
        alpha: float = 16.0,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.rank = rank
        self.alpha = alpha
        self.scaling = alpha / rank
        self.lora_A = nn.Parameter(torch.empty(rank, in_features))
        self.lora_B = nn.Parameter(torch.empty(out_features, rank))
        self.dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
        self.reset_parameters()

    def reset_parameters(self):
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
        nn.init.zeros_(self.lora_B)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        lora_out = self.dropout(x)
        lora_out = lora_out @ self.lora_A.T
        lora_out = lora_out @ self.lora_B.T
        return lora_out * self.scaling


class LinearWithLoRA(nn.Module):
    def __init__(
        self,
        original_layer: nn.Linear,
        rank: int = 8,
        alpha: float = 16.0,
        dropout: float = 0.05,
    ):
        super().__init__()
        self.original_layer = original_layer
        self.lora = LoRALayer(
            in_features=original_layer.in_features,
            out_features=original_layer.out_features,
            rank=rank,
            alpha=alpha,
            dropout=dropout,
        )
        self.original_layer.weight.requires_grad = False
        if self.original_layer.bias is not None:
            self.original_layer.bias.requires_grad = False

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.original_layer(x) + self.lora(x)

    def merge_weights(self):
        with torch.no_grad():
            merged_weight = (
                self.lora.lora_B @ self.lora.lora_A * self.lora.scaling
            )
            self.original_layer.weight.data += merged_weight
        return self.original_layer
```

### 2. 对 Transformer 注入 LoRA

```python
class LoRAConfig:
    rank: int = 8
    alpha: float = 16.0
    dropout: float = 0.05
    target_modules: list = None

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
        if self.target_modules is None:
            self.target_modules = ["q_proj", "v_proj"]


def inject_lora(model: nn.Module, config: LoRAConfig) -> nn.Module:
    """
    常见目标模块：
    ┌─────────────┬──────────────────────────────┐
    │  模块名      │  说明                        │
    ├─────────────┼──────────────────────────────┤
    │  q_proj      │  Query 投影 ⭐（推荐）        │
    │  k_proj      │  Key 投影                    │
    │  v_proj      │  Value 投影 ⭐（推荐）        │
    │  o_proj      │  Output 投影                 │
    │  gate_proj   │  FFN 门控投影                 │
    │  up_proj     │  FFN 上投影                   │
    │  down_proj   │  FFN 下投影                   │
    └─────────────┴──────────────────────────────┘
    """
    for param in model.parameters():
        param.requires_grad = False

    replaced = 0
    for name, module in model.named_modules():
        if isinstance(module, nn.Linear):
            short_name = name.split(".")[-1]
            if short_name in config.target_modules:
                parent_name = ".".join(name.split(".")[:-1])
                parent = model.get_submodule(parent_name)
                lora_layer = LinearWithLoRA(
                    original_layer=module,
                    rank=config.rank,
                    alpha=config.alpha,
                    dropout=config.dropout,
                )
                setattr(parent, short_name, lora_layer)
                replaced += 1

    print(f"已注入 {replaced} 个 LoRA 层")
    return model
```

### 3. 完整训练流程

```python
from torch.utils.data import DataLoader
from transformers import AutoModelForCausalLM, AutoTokenizer


def train_with_lora():
    model_name = "meta-llama/Llama-2-7b-hf"
    model = AutoModelForCausalLM.from_pretrained(
        model_name, torch_dtype=torch.bfloat16, device_map="auto",
    )
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    lora_config = LoRAConfig(
        rank=8, alpha=16.0, dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    model = inject_lora(model, lora_config)

    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=2e-4, weight_decay=0.01,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=1000, eta_min=1e-6
    )

    model.train()
    for epoch in range(3):
        for batch in train_dataloader:
            input_ids = batch["input_ids"].to(model.device)
            attention_mask = batch["attention_mask"].to(model.device)
            labels = batch["labels"].to(model.device)

            outputs = model(
                input_ids=input_ids, attention_mask=attention_mask, labels=labels,
            )
            loss = outputs.loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(
                filter(lambda p: p.requires_grad, model.parameters()), max_norm=1.0,
            )
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()

    save_lora_weights(model, "lora_weights.pt")


def save_lora_weights(model, path):
    lora_state_dict = {
        name: param for name, param in model.named_parameters() if param.requires_grad
    }
    torch.save(lora_state_dict, path)


def load_lora_weights(model, path):
    lora_state_dict = torch.load(path, map_location="cpu")
    model.load_state_dict(lora_state_dict, strict=False)
```

## 五、使用 PEFT 库（推荐生产使用）

```python
from peft import LoraConfig, get_peft_model, TaskType, PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer


def train_with_peft():
    model = AutoModelForCausalLM.from_pretrained(
        "meta-llama/Llama-2-7b-hf", torch_dtype=torch.bfloat16, device_map="auto",
    )

    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=8,
        lora_alpha=16,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        bias="none",
        modules_to_save=None,
    )

    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    training_args = TrainingArguments(
        output_dir="./lora_output",
        num_train_epochs=3,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        bf16=True,
        logging_steps=10,
        save_strategy="epoch",
        optim="adamw_torch",
    )

    trainer = Trainer(
        model=model, args=training_args,
        train_dataset=train_dataset, tokenizer=tokenizer,
    )
    trainer.train()

    model.save_pretrained("./lora_adapter")

    base_model = AutoModelForCausalLM.from_pretrained(
        "meta-llama/Llama-2-7b-hf", torch_dtype=torch.bfloat16, device_map="auto",
    )
    model = PeftModel.from_pretrained(base_model, "./lora_adapter")
    merged_model = model.merge_and_unload()
    merged_model.save_pretrained("./merged_model")
```

## 六、秩的选择策略

```
┌─────────────────────────────────────────────────────┐
│                  秩的选择决策树                        │
├─────────────────────────────────────────────────────┤
│                                                      │
│  任务与基座模型差异大吗？                               │
│  ├── 小（同领域风格微调）──→ r = 4~8                   │
│  ├── 中（跨领域适配）────→ r = 16~32                   │
│  └── 大（全新能力注入）──→ r = 64~128                  │
│                                                      │
│  训练数据量？                                          │
│  ├── < 1K 样本 ──→ r = 4~8  （防过拟合）              │
│  ├── 1K~10K    ──→ r = 8~16                          │
│  ├── 10K~100K  ──→ r = 16~32                         │
│  └── > 100K    ──→ r = 32~64                         │
│                                                      │
│  显存预算？                                            │
│  ├── 有限（单卡 24GB）──→ r = 8, 仅 q_proj/v_proj     │
│  ├── 中等（多卡 80GB）──→ r = 16, 全部 attention      │
│  └── 充足 ────────────→ r = 32+, attention + FFN     │
└─────────────────────────────────────────────────────┘
```

### 消融实验参考结果

```
典型结果（Llama-2-7B 在某分类任务）：
┌──────┬────────────┬───────────┬──────────┐
│ Rank │  Params    │ Eval Loss │ Accuracy │
├──────┼────────────┼───────────┼──────────┤
│  2   │   131,072  │  0.4521   │  87.2%   │
│  4   │   262,144  │  0.3845   │  89.1%   │
│  8   │   524,288  │  0.3312   │  91.5%   │ ← 性价比最高
│  16  │ 1,048,576  │  0.3198   │  92.1%   │
│  32  │ 2,097,152  │  0.3152   │  92.3%   │ ← 收益递减
│  64  │ 4,194,304  │  0.3140   │  92.4%   │
└──────┴────────────┴───────────┴──────────┘
```

## 七、LoRA 变体

```
┌─────────────┬──────────────────────────────────────────┐
│   变体名     │  核心改进                                 │
├─────────────┼──────────────────────────────────────────┤
│  LoRA       │  基础版本：ΔW = A·B                       │
│  LoRA+      │  A 和 B 使用不同学习率                     │
│  QLoRA      │  4-bit 量化基座 + LoRA（省显存）⭐          │
│  DoRA       │  分解为幅度和方向分别适配                    │
│  AdaLoRA    │  自适应分配不同层的秩                       │
│  rsLoRA     │  缩放因子改为 α/√r                        │
│  LoRA-FA    │  冻结 A，只训练 B                          │
│  VeRA       │  共享随机矩阵，只训练缩放向量               │
│  PiSSA      │  用 SVD 主成分初始化 A/B                   │
└─────────────┴──────────────────────────────────────────┘
```

### QLoRA 示例

```python
from transformers import BitsAndBytesConfig

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-70b-hf",
    quantization_config=bnb_config,
    device_map="auto",
)

peft_config = LoraConfig(
    r=16, lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
)
model = get_peft_model(model, peft_config)
```

## 八、总结

```
LoRA 秩微调核心要点：

1. 原理：冻结原始权重 W，学习低秩增量 ΔW = A·B
2. 秩 r：控制表达能力与参数量的平衡，通常 r=8 是好起点
3. Alpha：缩放因子，通常设为 r 的 1~2 倍
4. 目标模块：至少包含 q_proj 和 v_proj
5. 推理：可合并权重，零额外开销
6. 存储：仅需保存 LoRA 参数（几十 MB vs 几十 GB）
7. 生产推荐：使用 QLoRA + PEFT 库
```
