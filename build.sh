#!/bin/sh
# Mac / Linux build:  sh build.sh
set -e
cd "$(dirname "$0")"
g++ -std=c++14 -O2 -Wall -Wextra backend/server.cpp backend/coding.cpp -o server
g++ -std=c++14 -O2 -Wall -Wextra backend/client.cpp backend/coding.cpp -o client
g++ -std=c++14 -O2 -Wall -Wextra backend/test_packet.cpp -o test_packet
g++ -std=c++14 -O2 -Wall -Wextra backend/test_coding.cpp backend/coding.cpp -o test_coding
echo "built: server client test_packet test_coding"
