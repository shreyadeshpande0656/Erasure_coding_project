@echo off
rem Windows (MinGW) build:  build.bat
cd /d "%~dp0"
g++ -std=c++14 -O2 -Wall -Wextra backend/server.cpp backend/coding.cpp -o server.exe -lws2_32 || exit /b 1
g++ -std=c++14 -O2 -Wall -Wextra backend/client.cpp backend/coding.cpp -o client.exe -lws2_32 || exit /b 1
g++ -std=c++14 -O2 -Wall -Wextra backend/test_packet.cpp -o test_packet.exe || exit /b 1
g++ -std=c++14 -O2 -Wall -Wextra backend/test_coding.cpp backend/coding.cpp -o test_coding.exe || exit /b 1
echo built: server.exe client.exe test_packet.exe test_coding.exe
