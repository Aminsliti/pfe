$gitPath = "C:\Program Files\Git\bin\git.exe"
$projectPath = "c:\Users\msi\Desktop\pfetesting\pfeproject"

# Test git
& $gitPath --version

# Initialize git
& $gitPath init

# Add remote
& $gitPath remote add origin https://github.com/Aminsliti/pfe.git

# Create branch
& $gitPath checkout -b blackboxai/implementation

# Add files
& $gitPath add .

# Commit
& $gitPath commit -m "feat: Implement user authentication and RBAC"

# Push
& $gitPath push -u origin blackboxai/implementation
