@echo off
cd /d "c:\Users\msi\Desktop\pfetesting\pfeproject"
"C:\Program Files\Git\bin\git.exe" init
"C:\Program Files\Git\bin\git.exe" remote add origin https://github.com/Aminsliti/pfe.git
"C:\Program Files\Git\bin\git.exe" checkout -b blackboxai/implementation
"C:\Program Files\Git\bin\git.exe" add .
"C:\Program Files\Git\bin\git.exe" commit -m "feat: Implement user authentication and RBAC"
"C:\Program Files\Git\bin\git.exe" push -u origin blackboxai/implementation
pause
