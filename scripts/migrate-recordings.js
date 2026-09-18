const fs = require('fs');
const path = require('path');
const { db } = require(path.join(__dirname, '../src/database/db'));

const RECORDINGS_DIR = path.resolve(__dirname, '../recordings');
const TARGET_USER_ID = 'use_e8b444a9-1769-4667-9f83-ba05c6f3c371';

async function migrate() {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    console.log('No recordings directory found.');
    return;
  }

  const files = fs.readdirSync(RECORDINGS_DIR).filter(f => f.endsWith('.json') && f !== 'manifest.json');
  console.log(`Found ${files.length} workflows in recordings/`);

  let imported = 0;
  for (const file of files) {
    const filePath = path.join(RECORDINGS_DIR, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Check if already in db to avoid duplicates
      const existing = db.findOne('workflows', wf => wf.name === data.name || wf.id === file.replace('.json', ''));
      if (!existing) {
        db.insert('workflows', {
          id: file.replace('.json', ''),
          name: data.name || file.replace('.json', ''),
          description: data.description || 'Legacy workflow imported from filesystem',
          userId: TARGET_USER_ID,
          stepCount: Array.isArray(data.actions) ? data.actions.length : 0,
          recordingData: data
        });
        imported++;
        console.log(`Imported: ${file}`);
      } else {
        console.log(`Skipped (already exists): ${file}`);
      }
    } catch (err) {
      console.error(`Failed to import ${file}:`, err);
    }
  }

  console.log(`Migration complete. Imported ${imported} workflows.`);
}

migrate();
