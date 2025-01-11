-- Enable the pgvector extension to work with embeddings
create extension if not exists vector;

-- Create conversations table
create table if not exists conversations (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    message text not null,
    role text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    metadata jsonb default '{}'::jsonb
);

-- Create embeddings table
create table if not exists embeddings (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid references conversations(id) on delete cascade,
    embedding vector(1536),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create metadata table for additional context
create table if not exists memory_metadata (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid references conversations(id) on delete cascade,
    key text not null,
    value text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create indexes for better query performance
create index if not exists conversations_user_id_idx on conversations(user_id);
create index if not exists conversations_created_at_idx on conversations(created_at);
create index if not exists memory_metadata_key_idx on memory_metadata(key);

-- Enable row level security
alter table conversations enable row level security;
alter table embeddings enable row level security;
alter table memory_metadata enable row level security;

-- Create policies
create policy "Enable read access for all users" on conversations for select using (true);
create policy "Enable insert for authenticated users only" on conversations for insert with check (auth.role() = 'authenticated');

create policy "Enable read access for all users" on embeddings for select using (true);
create policy "Enable insert for authenticated users only" on embeddings for insert with check (auth.role() = 'authenticated');

create policy "Enable read access for all users" on memory_metadata for select using (true);
create policy "Enable insert for authenticated users only" on memory_metadata for insert with check (auth.role() = 'authenticated');