-- Create project_context table
create table if not exists project_context (
    id uuid primary key default gen_random_uuid(),
    section text not null,
    content jsonb not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create cursor_conversations table
create table if not exists cursor_conversations (
    id uuid primary key default gen_random_uuid(),
    summary text not null,
    full_context text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create function to update timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- Create trigger for updating timestamp
create trigger update_project_context_updated_at
    before update on project_context
    for each row
    execute function update_updated_at_column();

-- Enable RLS
alter table project_context enable row level security;
alter table cursor_conversations enable row level security;

-- Create policies
create policy "Enable read access for all users" on project_context for select using (true);
create policy "Enable insert for authenticated users only" on project_context for insert with check (auth.role() = 'authenticated');
create policy "Enable update for authenticated users only" on project_context for update using (auth.role() = 'authenticated');

create policy "Enable read access for all users" on cursor_conversations for select using (true);
create policy "Enable insert for authenticated users only" on cursor_conversations for insert with check (auth.role() = 'authenticated');