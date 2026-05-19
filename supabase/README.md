# Supabase

Run `schema.sql` in the Supabase SQL Editor whenever you need to set up or refresh the prototype database objects.

The file contains:

- `circles`, `circle_members`, and `memories` tables.
- `profiles` for default username and profile photo.
- `circle_join_requests` for invite-code requests that admins can approve or reject.
- A one-owner-per-circle rule plus automatic owner handoff when the current owner leaves or deletes their account.
- Row Level Security policies.
- `create_memory_circle(circle_name)` for creating a circle and owner membership together.
- `join_memory_circle(invite_code_input)` for joining an existing circle by invite code.
- `upload_daily_memory(...)` for the one-memory-per-user-per-day rule.
- `update_circle_nickname(circle_id_input, nickname_input)` for a nickname per user per circle.
- `update_circle_profile(...)` for admin-managed circle name and photo.
- `get_circle_members(circle_id_input)` and `get_circle_join_requests(circle_id_input)` for the circle profile sheet.
- `request_join_memory_circle(invite_code_input)` for invite-code join requests.
- `approve_join_request(...)`, `reject_join_request(...)`, `update_circle_member_role(...)`, and `remove_circle_member(...)` for owner/admin circle management.
- `ensure_circle_has_owner(circle_id_input)` and related triggers keep every non-empty circle with an owner.
- `like_memory(memory_id_input, like_date_input)` for circle-scoped daily likes.
- `add_memory_comment(memory_id_input, body_input)` for comments.
- `delete_memory(memory_id_input)` for author-only memory removal with sync-friendly tombstones.
- `report_memory(memory_id_input, reason_input)` for member reports on memories they do not own.
- `delete_current_user()` for authenticated in-app account deletion.
- `get_memory_gems(circle_id_input, gem_count)` for random past memories.

Keep future database changes in this folder so the app and database stay easy to rebuild.
