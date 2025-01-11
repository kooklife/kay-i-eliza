import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'http://127.0.0.1:54321'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const supabase = createClient(supabaseUrl, supabaseKey)

async function testCreativeRequests() {
  console.log('Testing connection to Supabase...')

  // Insert a test request
  const { data: insertedRequest, error: insertError } = await supabase
    .from('creative_requests')
    .insert({
      raw_content: 'Create a story about a magical garden',
      structured_content: {
        brief: 'A whimsical tale about a garden where flowers sing and trees dance',
        type: 'story',
        elements: ['magic', 'nature', 'music']
      },
      metadata: {
        status: 'pending',
        type: 'creative_writing',
        priority: 'medium'
      }
    })
    .select()

  if (insertError) {
    console.error('Error inserting request:', insertError)
    return
  }

  console.log('Inserted request:', insertedRequest)

  // Test the search functionality with proper tsquery format
  const { data: searchResults, error: searchError } = await supabase
    .from('creative_requests')
    .select()
    .textSearch('search_vector', 'magical & garden')

  if (searchError) {
    console.error('Error searching requests:', searchError)
    return
  }

  console.log('Search results:', searchResults)
}

testCreativeRequests().catch(console.error)