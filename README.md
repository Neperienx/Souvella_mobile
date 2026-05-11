# Souvella Mobile

Souvella is a shared memory-circle app for families, friends, trips, and close groups. The first version focuses on private circles where users can sign in, create or join a circle, see their circles, browse today's memories, and open a memory detail view.

## Recommended Stack

- **Expo + React Native** for one TypeScript codebase that runs on iOS and Android.
- **Expo Router** for file-based navigation that stays simple as the app grows.
- **Supabase Auth** for email/password login and user sessions.
- **Supabase Postgres** for circles, circle members, memories, comments, reactions, and base64 memory payloads.
- **React Native Async Storage** to persist Supabase sessions on device.
- **Async Storage memory cache** so each circle can keep a local copy and only download rows updated since the last sync.
- **Expo Image Picker, AV, and File System** for compressed photo selection, voice recording, and base64 file reads.
- **TypeScript** for safer app code and data contracts.

This stack is a strong fit because React Native avoids writing separate Swift/Kotlin apps, Expo reduces native setup work, and Supabase gives you authentication, database, storage, and realtime features without building a backend from scratch.

## App Flow

1. **Login screen**
   - Switch between Log in and Register.
   - Log in with email and password.
   - Register a new account with the same Supabase Auth backend.

2. **My circles dashboard**
   - Show all circles in a tile layout.
   - Put a `+` tile first so the user can create or join a group.
   - Ask whether the user wants to join an existing group or create a new one.

3. **Create or join circle**
   - Creating a circle generates an invite code and links the circle to the current user through `circle_members`.
   - Joining with an invite code links the existing circle to the current user through `circle_members`.

4. **Home / circle view**
   - Show an upload prompt until the current user has shared today's memory.
   - Enforce one memory per user per circle per day in the database.
   - Let each member set a nickname that is scoped to that circle.
   - Include a debug next-day button on the circle screen to test daily resets and memory gems.
   - Sync missing or updated memories into local device storage for offline reading.
   - Upload text, photo, or voice memories as base64 database payloads.
   - Show today's new memories and five random memory gems from the past.

5. **Memory detail**
   - Display a selected memory.
   - Support reactions, comments, and saving later.

## Getting Started

Install dependencies:

```bash
npm install
```

Create your local environment file:

```bash
cp example.env .env
```

Fill in the values from your Supabase project settings:

```env
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

Start the app:

```bash
npm run start
```

Then open it in Expo Go or an iOS/Android simulator.

## Supabase Setup

Create a Supabase project and enable email authentication. Then open the Supabase SQL Editor and run:

```sql
-- Copy and run the contents of supabase/schema.sql
```

The schema lives in [supabase/schema.sql](supabase/schema.sql). Keep future database changes in the `supabase` folder so there is one place to find and rerun setup SQL.

## Project Structure

```text
app/
  _layout.tsx          Root providers and navigation stack
  index.tsx            Auth-aware entry route
  auth.tsx             Login and account creation
  circles.tsx          Create, join, and list circles
  circle/[id].tsx      Circle home view
  memory/[id].tsx      Memory detail example
src/
  lib/memories.ts      Memory types, base64 helpers, and offline cache sync
  lib/supabase.ts      Supabase client
  theme.ts             Shared colors, spacing, and typography
```

## Notes

- Never commit `.env`; use `example.env` as the template.
- The anon key is safe for client apps when Row Level Security policies are correctly configured.
- The prototype stores memory payloads as base64 in Postgres. For large photos and long voice notes, keep compression aggressive or reconsider Supabase Storage later.
- Add EAS Build when you are ready to distribute test builds for iOS and Android.
