-- Create version history table
create table if not exists context_versions (
    id uuid primary key default gen_random_uuid(),
    section text not null,
    content jsonb not null,
    version_number bigint not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create index for version queries
create index if not exists context_versions_section_idx on context_versions(section);
create index if not exists context_versions_version_number_idx on context_versions(version_number);

-- Create function for conversation statistics
create or replace function get_conversation_stats()
returns table (
    category text,
    count bigint,
    last_updated timestamp with time zone
) language plpgsql as $$
begin
    return query
    select
        metadata->>'category' as category,
        count(*) as count,
        max(created_at) as last_updated
    from cursor_conversations
    where metadata->>'category' is not null
    group by metadata->>'category';
end;
$$;

-- Enable RLS
alter table context_versions enable row level security;

-- Create policies
create policy "Enable read access for all users" on context_versions for select using (true);
create policy "Enable insert for authenticated users only" on context_versions for insert with check (auth.role() = 'authenticated');

-- Add full text search capabilities
alter table cursor_conversations add column if not exists search_vector tsvector;
create index if not exists conversations_search_idx on cursor_conversations using gin(search_vector);

-- Create function to update search vector
create or replace function conversations_search_update() returns trigger as $$
begin
    new.search_vector :=
        setweight(to_tsvector('english', coalesce(new.summary,'')), 'A') ||
        setweight(to_tsvector('english', coalesce(new.full_context,'')), 'B');
    return new;
end
$$ language plpgsql;

-- Create trigger for search updates
create trigger conversations_search_update
    before insert or update
    on cursor_conversations
    for each row
    execute function conversations_search_update();