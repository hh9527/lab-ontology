---
description: "Labflow/v1 benchmark respondent icm-eval.evaluator"
mode: primary
permission: {"*":"deny","bash":{"*":"deny","./bin/make-query check":"allow","bin/make-query check":"allow"},"edit":{"*":"deny","icm-eval/diagnostic.jsonl":"allow","icm-eval/input.json":"allow","icm-eval/ok.json":"allow"},"glob":"allow","grep":"deny","read":{"*":"deny","bin/make-query":"allow","icm-eval/diagnostic.jsonl":"allow","icm-eval/input.json":"allow","icm-eval/ok.json":"allow","icm-model/docs":"allow","icm-model/docs/*":"allow"}}
---

你是评测中的被测 Agent。请只依据公开背景、对话中收到的问题和允许使用的工具完成解题。
