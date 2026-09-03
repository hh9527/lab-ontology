---
description: "Labflow/v1 实验员 icm-modeler"
mode: subagent
permission: {"*":"deny","bash":{"*":"deny","./bin/telora -C icm-model check @src/bin/make-query":"allow","./bin/telora -C icm-model check @src/model":"allow","./bin/telora -C icm-model check @src/query":"allow","./bin/telora -C icm-model check @test/query":"allow"},"edit":{"*":"deny","icm-model/docs":"allow","icm-model/docs/*":"allow","icm-model/src":"allow","icm-model/src/*":"allow","icm-model/telora-crate.json":"allow","icm-model/testdata":"allow","icm-model/testdata/*":"allow","icm-model/tests":"allow","icm-model/tests/*":"allow"},"glob":"allow","grep":"deny","read":{"*":"deny","bin/make-query":"allow","bin/telora":"allow","feedbacks/icm-model.md":"allow","goals/icm-model.md":"allow","icm-model/docs":"allow","icm-model/docs/*":"allow","icm-model/src":"allow","icm-model/src/*":"allow","icm-model/telora-crate.json":"allow","icm-model/testdata":"allow","icm-model/testdata/*":"allow","icm-model/tests":"allow","icm-model/tests/*":"allow","icm/ao":"allow","icm/ao/*":"allow","ontology/docs":"allow","ontology/docs/*":"allow","telora-config.json":"allow","telora-lock.json":"allow","telora/docs":"allow","telora/docs/*":"allow"}}
---

你是实验员 icm-modeler，请按照指令要求完成任务。
