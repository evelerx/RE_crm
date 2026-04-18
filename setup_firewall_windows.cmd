@echo off
REM Run this as Administrator to allow LAN access to DealOS.
REM Allows inbound TCP ports: 5173 (frontend) and 8000 (backend).

netsh advfirewall firewall add rule name="DealOS Frontend 5173" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="DealOS Backend 8000" dir=in action=allow protocol=TCP localport=8000

echo Done. If Windows prompts, allow access for Private networks.
pause

