DELETE FROM chat_thread_messages
WHERE rowid IN (
    SELECT d.rowid
    FROM (
        SELECT rowid,
               ROW_NUMBER() OVER (
                   PARTITION BY thread_id, role, execution_process_id
                   ORDER BY updated_at DESC, created_at DESC, rowid DESC
               ) AS rn
        FROM chat_thread_messages
        WHERE role = 'assistant' AND execution_process_id IS NOT NULL
    ) d
    WHERE d.rn > 1
);

CREATE UNIQUE INDEX idx_chat_thread_messages_thread_role_process
    ON chat_thread_messages(thread_id, role, execution_process_id);
