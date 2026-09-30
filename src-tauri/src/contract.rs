//! Checks the IPC payloads against `contracts/api-shapes.json`, the same file
//! the web API is tested against (src/backend/__tests__/api-contract.test.ts).
//! A field renamed on only one side fails one of the two suites.

#[cfg(test)]
mod tests {
    use crate::commands::data::{ExportBundle, ImportPayload, TrainingStats};
    use crate::db::models::*;
    use serde_json::{json, Value};

    fn shapes() -> Value {
        serde_json::from_str(include_str!("../../contracts/api-shapes.json")).expect("contract JSON")
    }

    fn assert_shape(entity: &str, value: impl serde::Serialize) {
        let value = serde_json::to_value(value).unwrap();
        let object = value.as_object().unwrap_or_else(|| panic!("{entity} is not an object"));
        let shapes = shapes();
        let missing: Vec<&str> = shapes[entity]
            .as_array()
            .unwrap_or_else(|| panic!("{entity} missing from contract"))
            .iter()
            .filter_map(|key| key.as_str())
            .filter(|key| !object.contains_key(*key))
            .collect();
        assert!(missing.is_empty(), "{entity} is missing {missing:?}; got {:?}", object.keys().collect::<Vec<_>>());
    }

    fn project() -> ProjectRecord {
        ProjectRecord {
            id: "p".into(), name: "P".into(), description: None, instructions: None,
            memory: None, pinned: false, created_at: 1, updated_at: 1,
        }
    }

    fn chat() -> ChatRecord {
        ChatRecord {
            id: "c".into(), title: "C".into(), project_id: Some("p".into()), project_root: None,
            system_prompt: None, pinned: false, model: None, role: None, created_at: 1, updated_at: 1,
        }
    }

    fn message() -> MessageRecord {
        MessageRecord { id: "m".into(), chat_id: "c".into(), role: "user".into(), content: "hi".into(), created_at: 1 }
    }

    #[test]
    fn ipc_payloads_match_contract() {
        assert_shape("project", project());
        assert_shape("chat", chat());
        assert_shape("message", message());
        assert_shape("skill", SkillRecord {
            id: "s".into(), name: "S".into(), description: None, content: "".into(),
            source_url: None, enabled: true, installed_at: 1,
        });
        assert_shape("trainingExample", TrainingExample {
            id: "m".into(), chat_id: "c".into(), chat_title: "C".into(), user_content: "q".into(),
            assistant_content: "a".into(), rating: 1, edited: false, created_at: 1,
        });
        assert_shape("trainingStats", TrainingStats {
            pairs: 0, explicit: 0, edited: 0, implicit: 0, distillation: 0, top_chats: 0, oldest: None, newest: None,
        });
        assert_shape("codingSession", CodingSessionRecord {
            chat_id: "c".into(), harness: "pi-harness".into(), harness_session_id: None,
            workspace_path: "/tmp".into(), status: "ready".into(), created_at: 1, updated_at: 1,
        });
        assert_shape("exportBundle", ExportBundle {
            exported_at: 1, projects: vec![project()], chats: vec![chat()], messages: vec![message()],
            settings: Default::default(),
        });
    }

    #[test]
    fn imports_web_exports_and_older_desktop_exports() {
        // Web export: camelCase, projects have no updatedAt.
        let web = json!({
            "exportedAt": 1,
            "projects": [{ "id": "p", "name": "P", "description": null, "instructions": null, "memory": null, "pinned": false, "createdAt": 5 }],
            "chats": [{ "id": "c", "projectId": "p", "title": "C", "model": null, "projectRoot": null, "systemPrompt": null,
                        "pinned": false, "role": null, "createdAt": 5, "updatedAt": 6, "usage": 0 }],
            "messages": [{ "id": "m", "chatId": "c", "role": "user", "content": "hi", "promptTokens": null,
                           "completionTokens": null, "createdAt": 7 }]
        });
        let payload: ImportPayload = serde_json::from_value(web).expect("web export should import");
        assert_eq!(payload.chats.unwrap()[0].project_id.as_deref(), Some("p"));
        assert_eq!(payload.messages.unwrap()[0].created_at, 7);

        // Desktop exports written before the switch to camelCase.
        let legacy = json!({
            "projects": [{ "id": "p", "name": "P", "pinned": true, "created_at": 5, "updated_at": 6 }],
            "chats": [{ "id": "c", "title": "C", "project_id": "p", "project_root": null, "system_prompt": null,
                        "pinned": false, "model": null, "role": null, "created_at": 5, "updated_at": 6 }],
            "messages": [{ "id": "m", "chat_id": "c", "role": "user", "content": "hi", "created_at": 7 }]
        });
        let payload: ImportPayload = serde_json::from_value(legacy).expect("legacy export should import");
        assert_eq!(payload.projects.unwrap()[0].updated_at, 6);
        assert_eq!(payload.messages.unwrap()[0].chat_id, "c");
    }
}
