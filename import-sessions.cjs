const fs = require('fs/promises');

async function importSessions() {
  try {
    console.log('📋 Reading OpenCode sessions...');
    
    // Read sessions from JSON file
    const data = await fs.readFile('opencode-sessions.json', 'utf-8');
    const sessions = JSON.parse(data);
    
    console.log('✅ Extracted ' + sessions.length + ' sessions');
    
    // Count sessions with completion data
    const withCompletion = sessions.filter(s => s.title && s.title.startsWith('{'));
    
    console.log('📊 Sessions with completion data: ' + withCompletion.length);
    
    // Parse completion status from session title
    function parseCompletionStatus(title) {
      try {
        if (title.startsWith('{') && title.includes('"pass"')) {
          const status = JSON.parse(title);
          return {
            pass: status.pass || false,
            reasons: status.reasons || []
          };
        }
        return { pass: false, reasons: ['No completion data in title'] };
      } catch (error) {
        return { pass: false, reasons: ['Invalid completion data format'] };
      }
    }
    
    // Transform session for SurrealDB
    function transformSession(session) {
      const status = parseCompletionStatus(session.title);
      
      return {
        id: session.id,
        title: session.title,
        status: status.pass ? 'completed' : 'failed',
        pass: status.pass,
        reasons: status.reasons,
        cost: 0,
        tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        created: new Date(session.created).toISOString(),
        updated: new Date(session.updated).toISOString(),
        agent: 'opencode-cli',
        model: 'unknown',
        directory: session.directory,
        project_id: session.projectId,
        duration: '0s',
        summary: { additions: 0, deletions: 0, files: [] }
      };
    }
    
    // Load into SurrealDB using curl
    console.log('📦 Loading sessions into SurrealDB...');
    
    for (const session of sessions.slice(0, 10)) { // Load first 10 for testing
      const transformed = transformSession(session);
      
      const curlCommand = `curl -X POST http://localhost:8000/sql \\
        -H "Content-Type: text/plain" \\
        -H "Authorization: Basic $(echo -n 'root:root' | base64)" \\
        -d "USE NS main DB main; CREATE opencode_sessions:${session.id} CONTENT ${JSON.stringify(transformed).replace(/"/g, '\\"')}"`;
      
      console.log('Loading session:', session.id);
      
      // Execute the curl command
      const { exec } = require('child_process');
      exec(curlCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('Error loading session', session.id, ':', error);
        } else {
          console.log('Loaded session', session.id);
        }
      });
    }
    
    console.log('✅ Import completed');
    
  } catch (error) {
    console.error('❌ Failed:', error);
  }
}

importSessions();