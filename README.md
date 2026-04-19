# Kit — Personal Relationship Management

Kit is a React Native / Expo app for managing contact relationships. It shows you who you're overdue to reach out to, surfaces context before you message them, and logs interactions to Open Brain.

## Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/): `npm install -g expo-cli`
- [EAS CLI](https://docs.expo.dev/eas-update/getting-started/) (for APK builds): `npm install -g eas-cli`
- Android device or emulator

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your Supabase credentials:

```
EXPO_PUBLIC_SUPABASE_URL=https://popxesemindihcbedegy.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your anon key from Supabase dashboard>
```

> Find your anon key at: Supabase Dashboard → Project Settings → API → `anon public`

### 3. Seed the database

The seed data is pre-generated at `src/data/seedData.json` from the 34 contacts in `People/`.

To regenerate it after editing markdown files:

```bash
npm run seed
```

This requires `gray-matter` and `ts-node` in devDependencies (already listed). The seed data is automatically loaded into SQLite on first app launch — no manual step needed.

## Running the app

```bash
# Start Expo dev server
npm start

# Or directly on Android
npm run android
```

Press `a` in the Expo terminal to open on Android emulator, or scan the QR code with Expo Go.

## Building an APK (Android)

### Option A — Local build (no EAS account needed)

```bash
npx expo run:android --variant release
```

The APK will be at `android/app/build/outputs/apk/release/app-release.apk`.

### Option B — EAS cloud build

```bash
# One-time setup
eas login
eas build:configure

# Build APK
eas build --platform android --profile preview
```

Add this profile to `eas.json` if it doesn't exist:

```json
{
  "build": {
    "preview": {
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

EAS will give you a download link when the build completes.

## Commands

### App (`kit/`)

| Command | What it does |
|---|---|
| `npm start` | Start the Expo app (choose platform) |
| `npm run android` | Start Expo on Android |
| `npm run ios` | Start Expo on iOS |
| `npm run seed` | Parse `People/*.md` files and upsert to Supabase |
| `npm test` | Run Jest tests |
| `npm run test:coverage` | Jest with coverage report |

### Gateway (`kit/gateway/`)

| Command | What it does |
|---|---|
| `npm run dev` | Start gateway with hot-reload |
| `npm start` | Start gateway (production) |
| `npm run mcp` | Start the MCP server for Claude Desktop |
| `npm run build` | TypeScript compile |
| `npm run lint` | ESLint |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with coverage |

### MCP tools (Claude Desktop, requires `npm run mcp`)

| Tool | What it does |
|---|---|
| `get_queue` | Overdue + due-this-week contacts |
| `get_contact` | Full detail for a contact |
| `search_contacts` | Search by name |
| `log_interaction` | Log a conversation |
| `add_follow_up` | Add a follow-up item |
| `complete_follow_up` | Mark a follow-up done |
| `sweep_now` | Trigger a WhatsApp history sweep |

## Project structure

```
app/
  _layout.tsx          Root navigation (Stack), DB init + seed on launch
  index.tsx            Home screen: Today's One Thing + due this week
  contact/[id].tsx     Contact detail: bio, follow-ups, interaction log, WhatsApp
  log/[id].tsx         Log interaction: free text + date, saves to SQLite + Supabase

src/
  db/database.ts       SQLite schema, seed, all queries
  lib/dateUtils.ts     Date helpers (overdue calc, frequency→days, formatting)
  lib/supabase.ts      Supabase client + logToOpenBrain()
  types/index.ts       TypeScript interfaces
  data/seedData.json   Pre-parsed contacts from People/ markdown files

scripts/
  seed.ts              Parses People/**/*.md → src/data/seedData.json
```

## How the seed works

`scripts/seed.ts` reads every `.md` file in `People/1 - Inner Circle/`, `People/2 - Active/`, and `People/3 - Business Contact/`. It parses:

- **YAML frontmatter** → contact fields (name, frequency, last_contact, next_action, social_battery)
- **`## How We Met` / `## Background` / `## Role & Context`** → `origin_story`
- **`## Interests & Hooks`, `## Sensitive Topics`, `## Notes`, `## Family`** → `notes`
- **`### YYYY-MM-DD — Type` blocks** → `interaction_log` table
- **`**Follow-ups:**` lists** → `follow_ups` table

Relationship tier is mapped: `1-Inner Circle → 1`, `2-Active → 2`, `3-Business Contact → 3`.

On first app launch, `_layout.tsx` checks the `meta` table for a `seeded` flag. If absent, it inserts all contacts, follow-ups, and interactions, then sets the flag. Subsequent launches skip seeding.

## Supabase / Open Brain integration

When you log an interaction, Kit writes to the `memories` table in your Supabase project:

```json
{
  "content": "Kit interaction — [Name] (YYYY-MM-DD): [your notes]",
  "domain": "kit",
  "type": "interaction"
}
```

If `EXPO_PUBLIC_SUPABASE_URL` is not configured or contains `your-project`, the write is silently skipped.

## Phase 2 (not built yet)

- Push notifications for overdue contacts
- AI message scaffolding ("What Do I Say?")
- Energy budget check-in
- Occasion awareness (birthdays, anniversaries)
- Settings screen
