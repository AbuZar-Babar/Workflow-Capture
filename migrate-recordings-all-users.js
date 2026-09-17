const fs = require('fs');
const path = require('path');
const { db } = require('./src/database/db');

const RECORDINGS_DIR = path.resolve(process.cwd(), 'recordings');

async function migrate() {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    console.log('No recordings directory found.');
    return;
  }

  const files = fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  console.log(`Found ${files.length} workflows in recordings/`);
  
  const users = db.find('users');
  console.log(`Found ${users.length} users. Coping workflows to all users.`);

  let imported = 0;
  for (const file of files) {
    const filePath = path.join(RECORDINGS_DIR, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      for (const user of users) {
        // Check if already in db for THIS user to avoid duplicates
        const existing = db.findOne('workflows', wf => wf.userId === user.id && (wf.name === data.name || wf.id === file.replace('.json', '') + '_' + user.id));
        if (!existing) {
          db.insert('workflows', {
            id: file.replace('.json', '') + '_' + user.id, // Make ID unique per user to avoid collision
            name: data.name || file.replace('.json', ''),
            description: data.description || 'Legacy workflow imported from filesystem',
            userId: user.id,
            stepCount: Array.isArray(data.actions) ? data.actions.length : 0,
            recordingData: data
          });
          imported++;
        }
      }
    } catch (err) {
      console.error(`Failed to import ${file}:`, err);
    }
  }

  console.log(`Migration complete. Imported ${imported} workflows total across all users.`);
}

migrate();
