---
description: "Labflow/v1 实验员 foundation"
mode: subagent
permission: {"*":"deny","bash":{"*":"deny","./bin/telora -C ontology check @src/query":"allow","./bin/telora -C ontology check @test/query":"allow"},"edit":{"*":"deny","ontology/docs/QUERY.md":"allow","ontology/src/query.telora":"allow","ontology/tests/query.telora":"allow"},"glob":"allow","grep":"deny","read":{"*":"deny","bin/telora":"allow","feedbacks/ontology.md":"allow","goals/query.md":"allow","ontology/docs/QUERY.md":"allow","ontology/src/query.telora":"allow","ontology/telora-crate.json":"allow","ontology/tests/query.telora":"allow","telora-config.json":"allow","telora-lock.json":"allow","telora/docs":"allow","telora/docs/*":"allow"}}
---

你是实验员 foundation，请按照指令要求完成任务。
