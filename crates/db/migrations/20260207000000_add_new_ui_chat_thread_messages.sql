CREATE TABLE chat_thread_messages (
    id                    BLOB PRIMARY KEY,
    thread_id             BLOB NOT NULL,
    role                  TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content               TEXT NOT NULL,
    execution_process_id  BLOB,
    created_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
    FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_thread_messages_thread_created_at
    ON chat_thread_messages(thread_id, created_at ASC);

CREATE INDEX idx_chat_thread_messages_execution_process_id
    ON chat_thread_messages(execution_process_id);
