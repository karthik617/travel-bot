# Comprehensive Implementation Plan: Autonomous AI Travel Backpacker (Tamil Nadu Engine)

## 1. Project Overview
We are building a real-time, autonomous, ambient travel dashboard featuring an AI backpacker named "Elango" who explores the state of Tamil Nadu, India. The application runs slowly in real-time, simulating realistic walking and bus journey speeds. The system operates on a 100% free architectural tech stack.

### Core User Experience Goals
*   **Ambient Engagement**: Users keep the tab open in their browser all day to watch the live-tracking map pin crawl down highways and explore temples.
*   **Audience Agency**: Users influence the journey directly via live voting, resource management mechanics, and a direct chat box where they can "talk" to Elango.

---

## 2. Technical Stack (100% Free Tiers)
*   **Framework**: Next.js 14+ (App Router) with Tailwind CSS.
*   **Database**: Supabase (Free tier PostgreSQL).
*   **Map System**: React-Leaflet (Client-side) with OpenStreetMap public raster tiles (No Google Maps API tokens required).
*   **Local Discovery Data**: Overpass API (OpenStreetMap engine) queried on the fly using geographic bounding circles.
*   **LLM Inference**: Local Instance of Qwen-2.5-7B/14B-Instruct running via **Ollama** (on `http://localhost:11434`) or a local **vLLM** server.
*   **Automation**: Vercel Cron Jobs (Triggers serverless background ticks).

---

## 3. Database Schema (Supabase PostgreSQL)

Execute this script inside the Supabase SQL Editor to establish the underlying state machine, including the new public chat feature:

```sql
-- Core table tracking historical stops and live location status
CREATE TABLE bot_state (
    id SERIAL PRIMARY KEY,
    lat FLOAT NOT NULL,
    lon FLOAT NOT NULL,
    current_city VARCHAR(255) NOT NULL,
    landmark_name VARCHAR(255),
    story TEXT,
    energy INT DEFAULT 100 CHECK (energy >= 0 AND energy <= 100),
    wallet INT DEFAULT 2000 CHECK (wallet >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table holding community vote options generated during major junction points
CREATE TABLE active_votes (
    id SERIAL PRIMARY KEY,
    option_a_title VARCHAR(255) NOT NULL,
    option_a_lat FLOAT NOT NULL,
    option_a_lon FLOAT NOT NULL,
    option_b_title VARCHAR(255) NOT NULL,
    option_b_lat FLOAT NOT NULL,
    option_b_lon FLOAT NOT NULL,
    option_a_count INT DEFAULT 0,
    option_b_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Public live chat table allowing users to speak with Elango
CREATE TABLE live_chat (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    reply TEXT, -- Handled by local Qwen when a message is dropped
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## 4. Engagement & Gamification Mechanics (Crucial Features)

To maintain sticky user loops, implement four hard-coded interactive systems:

### A. Real-Time Resource Bars (Energy & Wallet)
*   The traveler has an **Energy %** bar and a **Wallet (₹)** count displayed prominently.
*   **Passive Decay**: Every serverless execution tick drains energy by 5% and spending money by ₹40 (simulating buying local snacks, entry passes, and bus tickets).
*   **Interactive Recovery**: Provide two free buttons on the UI for web visitors:
    1.  `☕ Buy Filter Coffee (Cost: Free for user)`: Adds +15% Energy, subtracts ₹30 from Wallet.
    2.  `🚌 Fund Local Bus (Cost: Free for user)`: Triggers a state movement jump to a nearby town node instantly.

### B. The Fork in the Road (Daily Strategic Voting)
*   Every 12 hours, the background agent detects if it has reached a milestone hub city (e.g., Trichy or Madurai).
*   If true, it generates an entry in `active_votes` presenting two routes (e.g., *Option A: Remote Coastal Temples* vs *Option B: Inland Hill Stations*).
*   The front-end exposes an active polling card allowing users to click and upvote choices. The background routine reads the highest count on the next major cycle to determine geographical heading.

### C. Live Chat Messages (Talking with Elango)
*   Visitors can enter a temporary handle name and drop text messages into Elango's "walkie-talkie" chat window.
*   When a new record inserts into `live_chat`, an API trigger passes the user query to the local Qwen instance.
*   Qwen generates a direct response contextualized by Elango's current location data (e.g., *"Hey Amit, just resting near the Madurai temple steps right now, eating some local bun parotta! Come join!"*).

---

## 5. File Construction Matrix

Please generate code matching the exact structures below:

### File 1: `src/app/api/travel-tick/route.js`
This serverless function manages geographic increment calculations.
*   **Coordinate Progression**: Grab the newest log from `bot_state`. Calculate a minute micro-step toward the target endpoint.
*   **Overpass Node Extraction**: Send a GET request to the OpenStreetMap parser to fetch regional entities inside a 3km radius:
    `https://overpass-api.de[out:json];node(around:3000,${lat},${lon})[tourism];out;`
*   **Local Ollama Qwen Integration**: Package the location info and call local Ollama (`POST http://127.0.0`) with model `qwen2.5:7b` (or `qwen2.5:14b`).
    *Prompt*: *"You are an enthusiastic Indian backpacker currently trekking past [Landmark] in [City], Tamil Nadu. Describe what you see in two conversational sentences using sensory markers like local food smells or weather conditions. Do not sound like an AI robot."*
*   **Database Mutation**: Insert the generated output string alongside revised coordinates back into Supabase.

### File 2: `src/app/api/chat/route.js`
This file handles inbound user messages and generates a dynamic reply from Elango using the local model.
*   Accepts `username` and `message` strings via a POST request.
*   Fetches the absolute latest location state from `bot_state` to understand context.
*   Constructs a tailored local Ollama query:
    *System Prompt*: `"You are Elango, a cozy human backpacker currently hanging out at [Landmark] in [City], Tamil Nadu. Answer your stream follower's message in one warm sentence. Keep it highly colloquial, human, and relevant to your physical location."`
*   Saves both the incoming message and the local Qwen generation reply row inside `live_chat`.

### File 3: `src/components/TravelMap.js`
A client-side boundary tracking component.
*   Isolate Leaflet dependencies using `use client` to dodge Next.js SSR crashes.
*   Draw an active map container centered at the primary location vectors.
*   Attach a custom marker configuration overlay indicating the traveler's position.

### File 4: `src/app/page.js`
The master system presentation layer.
*   Divide into a wide 3-column or responsive grid layout (Left: Map Canvas; Middle: Social Update Timeline Feed & Controls; Right: Live Chat Box).
*   Add dynamic metric score indicators displaying current Wallet sums and Energy meters.
*   Expose the functional action buttons triggering interactive state adjustments.
*   Build the client chat submit layout that runs smooth periodic polling to display fresh messages and Elango's local responses without disrupting the page structure.

---

## 6. Execution Steps for the Code Agent
1.  **Dependencies**: Configure project packages inside `package.json` to include `@supabase/supabase-js`, `lucide-react`, `react-leaflet`, and `leaflet`.
2.  **Ollama Network Management**: Ensure HTTP client handlers use structured json payload wrappers (`{ "model": "qwen2.5:7b", "prompt": "...", "stream": false }`) when interfacing with local daemons.
3.  **UI Polish**: Use Tailwind's `animate-pulse` on a green `● ELANGO IS WALKING` badge to accent real-time tracking authenticity. Use crisp, modern styling patterns (e.g., `slate-900` headings, clean borders).
