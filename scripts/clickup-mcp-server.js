const https = require('https');
const readline = require('readline');

const API_KEY = process.env.CLICKUP_API_KEY || 'pk_67511632_LVYJ1VYDOXQACVATB5EH3P48F9WBNVC0';

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.clickup.com',
      path: path,
      method: method,
      headers: {
        'Authorization': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

const TOOLS = [
  {
    name: 'clickup_get_workspaces',
    description: 'Get all ClickUp workspaces (teams) for the authenticated user.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'clickup_get_spaces',
    description: 'Get all spaces in a ClickUp workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Workspace / Team ID' }
      },
      required: ['team_id']
    }
  },
  {
    name: 'clickup_get_folders',
    description: 'Get all folders in a space.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Space ID' }
      },
      required: ['space_id']
    }
  },
  {
    name: 'clickup_get_lists',
    description: 'Get all folderless lists in a space, or lists in a folder.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Space ID (for folderless lists)' },
        folder_id: { type: 'string', description: 'Folder ID (for folder lists)' }
      }
    }
  },
  {
    name: 'clickup_get_tasks',
    description: 'Get tasks from a list.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'List ID' },
        include_closed: { type: 'boolean', description: 'Include closed/completed tasks' }
      },
      required: ['list_id']
    }
  },
  {
    name: 'clickup_create_task',
    description: 'Create a new task in a list.',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string', description: 'List ID' },
        name: { type: 'string', description: 'Task name' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'number', description: 'Priority: 1 (Urgent), 2 (High), 3 (Normal), 4 (Low)' },
        due_date: { type: 'number', description: 'Unix timestamp in ms' }
      },
      required: ['list_id', 'name']
    }
  },
  {
    name: 'clickup_update_task',
    description: 'Update an existing task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID' },
        name: { type: 'string', description: 'Task name' },
        description: { type: 'string', description: 'Task description' },
        status: { type: 'string', description: 'Task status' },
        priority: { type: 'number', description: 'Priority: 1-4' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'clickup_delete_task',
    description: 'Delete a task by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID' }
      },
      required: ['task_id']
    }
  }
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'clickup_get_workspaces':
      return await apiRequest('GET', '/api/v2/team');
    case 'clickup_get_spaces':
      return await apiRequest('GET', '/api/v2/team/' + args.team_id + '/space?archived=false');
    case 'clickup_get_folders':
      return await apiRequest('GET', '/api/v2/space/' + args.space_id + '/folder?archived=false');
    case 'clickup_get_lists':
      if (args.folder_id) {
        return await apiRequest('GET', '/api/v2/folder/' + args.folder_id + '/list?archived=false');
      } else if (args.space_id) {
        return await apiRequest('GET', '/api/v2/space/' + args.space_id + '/list?archived=false');
      }
      throw new Error('Must provide either space_id or folder_id');
    case 'clickup_get_tasks': {
      const closed = args.include_closed ? 'true' : 'false';
      return await apiRequest('GET', '/api/v2/list/' + args.list_id + '/task?include_closed=' + closed);
    }
    case 'clickup_create_task':
      return await apiRequest('POST', '/api/v2/list/' + args.list_id + '/task', {
        name: args.name,
        description: args.description,
        priority: args.priority,
        due_date: args.due_date,
        due_date_time: false
      });
    case 'clickup_update_task':
      return await apiRequest('PUT', '/api/v2/task/' + args.task_id, {
        name: args.name,
        description: args.description,
        status: args.status,
        priority: args.priority
      });
    case 'clickup_delete_task':
      return await apiRequest('DELETE', '/api/v2/task/' + args.task_id);
    default:
      throw new Error('Unknown tool: ' + name);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async line => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return;
  }

  if (msg.method === 'initialize') {
    const response = {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'clickup-direct-mcp', version: '1.0.0' }
      }
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  } else if (msg.method === 'notifications/initialized') {
    // No-op
  } else if (msg.method === 'tools/list') {
    const response = {
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: TOOLS }
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  } else if (msg.method === 'tools/call') {
    try {
      const toolName = msg.params.name;
      const toolArgs = msg.params.arguments || {};
      const result = await handleToolCall(toolName, toolArgs);
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            { type: 'text', text: JSON.stringify(result, null, 2) }
          ]
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    } catch (err) {
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            { type: 'text', text: 'Error: ' + err.message }
          ],
          isError: true
        }
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } else if (msg.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: {}
    }) + '\n');
  }
});
