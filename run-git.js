const { execSync } = require('child_process');
const path = require('path');

const gitPath = 'C:\\Program Files\\Git\\bin\\git.exe';

try {
  const version = execSync(`"${gitPath}" --version`, { encoding: 'utf8' });
  console.log('Git version:', version);
  
  // Initialize git
  execSync(`"${gitPath}" init`, { cwd: path.join(__dirname), encoding: 'utf8' });
  console.log('Git init done');
  
  // Add remote
  execSync(`"${gitPath}" remote add origin https://github.com/Aminsliti/pfe.git`, { cwd: path.join(__dirname), encoding: 'utf8' });
  console.log('Remote added');
  
  // Create branch
  execSync(`"${gitPath}" checkout -b blackboxai/implementation`, { cwd: path.join(__dirname), encoding: 'utf8' });
  console.log('Branch created');
  
  // Add files
  execSync(`"${gitPath}" add .`, { cwd: path.join(__dirname), encoding: 'utf8' });
  console.log('Files added');
  
  // Commit
  execSync(`"${gitPath}" commit -m "feat: Implement user authentication and RBAC"`, { cwd: path.join(__dirname), encoding: 'utf8' });
  console.log('Committed');
  
  // Push
  execSync(`"${gitPath}" push -u origin blackboxai/implementation`, { cwd: path.join(__dirname), encoding: 'utf8' });
  console.log('Pushed to origin');
  
  console.log('SUCCESS: All git operations completed!');
} catch (error) {
  console.error('Error:', error.message);
}
