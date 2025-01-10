# Context Sync Plugin

A plugin for syncing chat context between Cursor, Kay-i, and other platforms.

## Features

- Automatic sync of Cursor chat and composer history
- Cross-platform context sharing
- Working state tracking
- Semantic search across conversations
- Project context management

## Setup

1. Start local Supabase:
```bash
supabase start
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Apply database migrations:
```bash
supabase migration up
```

4. Install dependencies:
```bash
pnpm install
```

## Testing

Run the test script:
```bash
pnpm test
```

This will:
1. Sync current Cursor chat history
2. Test tagging functionality
3. Test search capabilities
4. Test context retrieval

## Usage

```typescript
import { init } from '@kay-i/plugin-context-sync';

// Initialize plugin
const contextSync = init({
    autoSync: true,
    syncInterval: 5 * 60 * 1000  // 5 minutes
});

// Tag a working state
await contextSync.tagConversation(conversationId, {
    name: "working_state",
    value: "Feature X implemented and tested",
    timestamp: Date.now()
});

// Get context for new chat
const context = await contextSync.getContextForNewChat();

// Search conversations
const results = await contextSync.searchConversations("feature implementation", {
    type: "composer",
    workingStatesOnly: true
});
```

## Database Schema

The plugin uses two main tables:

1. `enhanced_conversations`:
   - Stores all chat history with metadata
   - Supports full-text search
   - Includes vector embeddings for semantic search

2. `project_context`:
   - Stores current project state
   - Tracks working states and dependencies

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request