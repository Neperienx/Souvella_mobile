# Supabase

Run `schema.sql` in the Supabase SQL Editor whenever you need to set up or refresh the prototype database objects.

The file contains:

- `circles`, `circle_members`, and `memories` tables.
- Row Level Security policies.
- `create_memory_circle(circle_name)` for creating a circle and owner membership together.
- `join_memory_circle(invite_code_input)` for joining an existing circle by invite code.
- `upload_daily_memory(...)` for the one-memory-per-user-per-day rule.
- `update_circle_nickname(circle_id_input, nickname_input)` for a nickname per user per circle.
- `get_memory_gems(circle_id_input, gem_count)` for random past memories.

Keep future database changes in this folder so the app and database stay easy to rebuild.
