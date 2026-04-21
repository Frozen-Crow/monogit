import fs from 'fs';
import path from 'path';
import os from 'os';

const home = os.homedir();

const configs = [
  {
    file: '.zshrc',
    line: '\n# monogit completion\ncommand -v monogit >/dev/null 2>&1 && source <(monogit completion zsh)\n'
  },
  {
    file: '.bashrc',
    line: '\n# monogit completion\ncommand -v monogit >/dev/null 2>&1 && source <(monogit completion bash)\n'
  }
];

function install() {
  console.log('Installing shell completions...');
  
  for (const config of configs) {
    const filePath = path.join(home, config.file);
    
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        if (!content.includes('monogit completion')) {
          fs.appendFileSync(filePath, config.line);
          console.log(`✅ Added completion to ${config.file}`);
        } else {
          console.log(`ℹ️ Completion already exists in ${config.file}`);
        }
      }
    } catch (err) {
      console.warn(`⚠️ Could not update ${config.file}: ${err.message}`);
    }
  }
}

install();
