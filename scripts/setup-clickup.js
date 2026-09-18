const https = require('https');

const API_KEY = 'pk_67511632_LVYJ1VYDOXQACVATB5EH3P48F9WBNVC0';
const TEAM_ID = '1100340000005233';

function request(method, path, body = null) {
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
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  
  const structure = [
    {
      name: 'PM & Milestones',
      color: '#40BC86',
      lists: [
        {
          name: 'Sprint Roadmaps & Milestones',
          tasks: [
            {
              name: '🎯 Milestone 1: Core Auth, Database & REST API Completion',
              description: '**Objective**: Finalize user authentication, JWT tokens, user store, and basic workflow CRUD endpoints.\n\n**Lead**: AbuZar (Backend)',
              priority: 2, // High
              due_date: now + 3 * day
            },
            {
              name: '🎯 Milestone 2: Frontend Dashboard & Visual Debugger Integration',
              description: '**Objective**: Integrate UI dashboard with backend APIs and finish visual replay debugger overlay.\n\n**Lead**: Alina (Frontend)',
              priority: 2, // High
              due_date: now + 5 * day
            },
            {
              name: '🎯 Milestone 3: Advanced CDP Engine & Multi-Tab / Iframe Resilience',
              description: '**Objective**: Support iframes, shadow DOM, file upload/download, and loop replay.\n\n**Lead**: AbuZar (Backend)',
              priority: 2, // High
              due_date: now + 6 * day
            },
            {
              name: '🎯 Milestone 4: Final End-to-End Release & FYP Documentation',
              description: '**Objective**: Final smoke testing, branch merge, demo recording, and documentation.\n\n**Lead**: AbuZar & Alina',
              priority: 1, // Urgent
              due_date: now + 8 * day
            }
          ]
        },
        {
          name: 'Daily Standups & Blockers',
          tasks: [
            {
              name: '📌 Daily Sync & API Contract Alignment',
              description: 'Continuous checkpoint to ensure frontend and backend schemas remain synchronized without merge conflicts.',
              priority: 3, // Normal
              due_date: now + 7 * day
            }
          ]
        }
      ]
    },
    {
      name: 'Backend & Core Engine',
      color: '#5f55ee',
      lists: [
        {
          name: 'Auth & Security Layer',
          tasks: [
            {
              name: '🔒 User Data Model & Password Hashing',
              description: 'Implement secure salted password hashing using crypto.scrypt or bcrypt with input validation.\n\n**Module**: `src/auth/password-util.js` & `src/database/`',
              priority: 1,
              due_date: now + 2 * day
            },
            {
              name: '🔑 JWT Token Issuance & Auth Middleware',
              description: 'Implement token generation, expiration, verification, and route protection middleware (`authMiddleware`).\n\n**Module**: `src/auth/token-service.js`, `src/auth/auth-middleware.js`',
              priority: 1,
              due_date: now + 2 * day
            },
            {
              name: '🛡️ Runtime Credential Vault & Secret Injection',
              description: 'Securely replace `[REDACTED]` password tokens during browser replay using user secrets or environment variables.\n\n**Module**: `src/auth/secret-util.js`',
              priority: 2,
              due_date: now + 4 * day
            }
          ]
        },
        {
          name: 'REST APIs & Execution Engine',
          tasks: [
            {
              name: '📡 Workflow CRUD API Endpoints',
              description: 'Expose endpoints for creating, reading, updating, and deleting recorded workflows (`/api/workflows`).\n\n**Module**: `src/api/workflow-controller.js`',
              priority: 1,
              due_date: now + 3 * day
            },
            {
              name: '⚡ Execution Dispatcher & Real-time SSE Stream',
              description: 'Implement execution trigger (`POST /api/workflows/:id/execute`) and Server-Sent Events for live run logs (`GET /api/runs/:id/logs`).\n\n**Module**: `src/api/run-controller.js`',
              priority: 1,
              due_date: now + 4 * day
            },
            {
              name: '📦 Artifacts & Run Manifest ZIP Exporter',
              description: 'Expose endpoints to retrieve downloaded files, run screenshots, and consolidated execution reports.\n\n**Module**: `src/api/run-controller.js`',
              priority: 2,
              due_date: now + 5 * day
            }
          ]
        },
        {
          name: 'Advanced CDP Automation Core',
          tasks: [
            {
              name: '🌐 Iframe & Nested Frame Recording & Replay',
              description: 'Detect actions within `<iframe>` elements, store frame hierarchy paths, and switch execution context during replay.',
              priority: 2,
              due_date: now + 5 * day
            },
            {
              name: '🧩 Shadow DOM & Web Component Pierceable Selectors',
              description: 'Traverse open shadow roots (`element.shadowRoot`) and generate deep pierceable selector chains.',
              priority: 2,
              due_date: now + 6 * day
            },
            {
              name: '🪟 Multi-Tab & Popup Window Target Listener',
              description: 'Track `targetcreated` CDP events and associate recorded actions with newly opened browser tabs/windows.',
              priority: 2,
              due_date: now + 6 * day
            },
            {
              name: '📥 File Upload & Download Interception',
              description: 'Capture file inputs and transfer payloads via `Page.setFileInputFiles` while intercepting downloads.',
              priority: 2,
              due_date: now + 6 * day
            }
          ]
        }
      ]
    },
    {
      name: 'Frontend & Visual Tools',
      color: '#e5484d',
      lists: [
        {
          name: 'Dashboard UI & Layout',
          tasks: [
            {
              name: '🎨 Modern Dashboard Layout & Design System',
              description: 'Build responsive sidebar, header, global state, dark/light theme, and card components.\n\n**Folder**: `src/dashboard/public/`',
              priority: 1,
              due_date: now + 2 * day
            },
            {
              name: '📋 Workflows Management View',
              description: 'Interactive list of saved workflows with search, filter, tags, and one-click execution modal.\n\n**Module**: `src/dashboard/public/js/views/workflowsView.js`',
              priority: 1,
              due_date: now + 3 * day
            },
            {
              name: '🔐 Secrets & Account Settings View',
              description: 'UI for managing credential vault items, user profile, and session tokens.\n\n**Module**: `src/dashboard/public/js/views/secretsView.js`',
              priority: 2,
              due_date: now + 4 * day
            }
          ]
        },
        {
          name: 'Interactive Visual Replay Debugger',
          tasks: [
            {
              name: '⏯️ Step-by-Step Replay Controller',
              description: 'Interactive playback bar with Play, Pause, Next Step (`--step` mode), and execution speed control.',
              priority: 1,
              due_date: now + 4 * day
            },
            {
              name: '🎯 Target Element Bounding Box Overlay',
              description: 'Draw visible animated highlight box on active DOM target element during replay with confidence score badge.',
              priority: 2,
              due_date: now + 5 * day
            }
          ]
        },
        {
          name: 'Workflow Editor & Recording Toolbar',
          tasks: [
            {
              name: '🎞️ Visual Step Timeline & Reordering',
              description: 'Drag-and-drop workflow step timeline with action badges, selector inspector, and screenshot previews.\n\n**Module**: `src/dashboard/public/js/views/workflowEditorView.js`',
              priority: 2,
              due_date: now + 5 * day
            },
            {
              name: '🔴 In-Page Floating Recording Toolbar',
              description: 'Injected floating HUD bar with Pause, Resume, Add Checkpoint Assertion, and Stop recording controls.',
              priority: 2,
              due_date: now + 6 * day
            }
          ]
        },
        {
          name: 'Execution Console & Live Logs',
          tasks: [
            {
              name: '💻 Real-time Live Log Stream Viewer',
              description: 'Terminal-style live console connected via SSE to stream CDP events, step completions, and timings.\n\n**Module**: `src/dashboard/public/js/views/consoleView.js`',
              priority: 1,
              due_date: now + 4 * day
            },
            {
              name: '🖼️ Artifact Viewer & Error Screenshot Modal',
              description: 'Visual inspector for downloaded run files, manifests, and failure screenshots with error diagnostics.',
              priority: 2,
              due_date: now + 6 * day
            }
          ]
        }
      ]
    },
    {
      name: 'QA, Testing & Integration',
      color: '#f76808',
      lists: [
        {
          name: 'E2E Testing & Regression Suite',
          tasks: [
            {
              name: '🧪 Mock Portal Regression Testing',
              description: 'Execute automated smoke tests covering selector resolution, login, looping, and file downloads.\n\n**Command**: `npm run test`',
              priority: 1,
              due_date: now + 6 * day
            },
            {
              name: '🌐 Live Target Portal Multi-Step Validation',
              description: 'Test end-to-end recording and replaying against 3+ real-world web applications (ERP, E-commerce, Portals).',
              priority: 2,
              due_date: now + 7 * day
            }
          ]
        },
        {
          name: 'Branch Integration & Final Deliverable',
          tasks: [
            {
              name: '🔀 Merge generic-login & UI-for-dashboard into main',
              description: 'Perform conflict-free branch merge, run full test suite, and verify backend-frontend integration.',
              priority: 1,
              due_date: now + 7 * day
            },
            {
              name: '📚 Final Documentation & Demonstration Deck',
              description: 'Complete project README, API docs, system architecture diagrams, and high-quality video demo presentation.',
              priority: 1,
              due_date: now + 8 * day
            }
          ]
        }
      ]
    }
  ];

  for (const sp of structure) {
    console.log('\nCreating Space:', sp.name);
    const spaceRes = await request('POST', '/api/v2/team/' + TEAM_ID + '/space', {
      name: sp.name,
      multiple_assignees: true,
      features: {
        due_dates: { enabled: true, start_date: true },
        time_tracking: { enabled: true },
        priorities: { enabled: true },
        tags: { enabled: true },
        check_unresolved: { enabled: true }
      }
    });

    if (spaceRes.status !== 200) {
      console.error('Failed to create space:', sp.name, spaceRes.data);
      continue;
    }

    const spaceId = spaceRes.data.id;
    console.log('  Space Created! ID:', spaceId);
    await sleep(400);

    for (const lst of sp.lists) {
      console.log('  Creating List:', lst.name);
      const listRes = await request('POST', '/api/v2/space/' + spaceId + '/list', {
        name: lst.name
      });

      if (listRes.status !== 200) {
        console.error('  Failed to create list:', lst.name, listRes.data);
        continue;
      }

      const listId = listRes.data.id;
      console.log('    List Created! ID:', listId);
      await sleep(300);

      for (const tsk of lst.tasks) {
        const taskPayload = {
          name: tsk.name,
          description: tsk.description,
          priority: tsk.priority,
          due_date: tsk.due_date,
          due_date_time: false
        };

        const taskRes = await request('POST', '/api/v2/list/' + listId + '/task', taskPayload);
        if (taskRes.status === 200) {
          console.log('      + Task:', tsk.name, '(ID: ' + taskRes.data.id + ')');
        } else {
          console.error('      ! Failed task:', tsk.name, taskRes.data);
        }
        await sleep(250);
      }
    }
  }

  console.log('\n=== All Spaces, Lists, and Tasks Successfully Created in ClickUp! ===');
}

main().catch(console.error);
