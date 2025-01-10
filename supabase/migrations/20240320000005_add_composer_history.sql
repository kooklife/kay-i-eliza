-- Create composer history table
create table if not exists cursor_composer_history (
    id uuid primary key default gen_random_uuid(),
    summary text not null,
    full_context text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    search_vector tsvector
);

-- Create index for full text search
create index if not exists composer_history_search_idx on cursor_composer_history using gin(search_vector);

-- Create function to update search vector
create or replace function composer_history_search_update() returns trigger as $$
begin
    new.search_vector :=
        setweight(to_tsvector('english', coalesce(new.summary,'')), 'A') ||
        setweight(to_tsvector('english', coalesce(new.full_context,'')), 'B');
    return new;
end
$$ language plpgsql;

-- Create trigger for search updates
create trigger composer_history_search_update
    before insert or update
    on cursor_composer_history
    for each row
    execute function composer_history_search_update();

-- Enable RLS
alter table cursor_composer_history enable row level security;

-- Create policies
create policy "Enable read access for all users" on cursor_composer_history for select using (true);
create policy "Enable insert for authenticated users only" on cursor_composer_history for insert with check (auth.role() = 'authenticated');