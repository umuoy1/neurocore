# Claude Rules

- 除非用户明确要求，否则不要在代码中添加注释。

## 设计对齐原则

所有代码的设计与编写必须遵循 `docs/` 中的设计文档和 milestone 规划。核心要求：

1. **不偏离设计目标** — 每次改动前先确认 docs 中的对应定义（Schema、SPI、模块职责、生命周期），不得凭直觉做局部 patch。
2. **与设计闭环** — 改动必须能追溯到某份设计文档中的具体条目（FR 编号、里程碑任务、Schema 字段、SPI 接口等），并在 commit message 中体现。
3. **及时回归** — 改动完成后对照 `docs/mvp_gaps_and_next_steps.md` 和 `docs/gap_analysis_and_roadmap.md` 检查完成度变化，确保不引入新的偏差。
4. **不做局部 patch** — 如果发现设计文档与实现不一致，优先修正实现以对齐设计，而非在实现上打补丁绕过。如果设计本身需要调整，先更新 docs 再改代码。
5. **Milestone 驱动** — 按 `gap_analysis_and_roadmap.md` 中的优先级（P0 → P1 → P2）推进，不跳级、不超前做未规划的能力。
6. **及时更新进度文档** — 每次完成功能改动后，同步更新 `docs/mvp_gaps_and_next_steps.md` 和 `docs/gap_analysis_and_roadmap.md` 中的完成状态、完成度百分比和剩余待办，保持文档与代码实现一致。
