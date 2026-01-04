#pragma once

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "iphlpapi.lib")
#else
#include <arpa/inet.h>
#include <ifaddrs.h>
#endif

#include <string>

inline std::string GetLocalIP() {
    std::string ip = "127.0.0.1";

#ifdef _WIN32
    // Initialize Winsock
    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        return ip;
    }

    ULONG flags = GAA_FLAG_INCLUDE_PREFIX;
    ULONG family = AF_INET; // IPv4 only

    PIP_ADAPTER_ADDRESSES adapterAddresses = nullptr;
    ULONG outBufLen = 0;
    DWORD ret = GetAdaptersAddresses(family, flags, nullptr, adapterAddresses, &outBufLen);
    if (ret == ERROR_BUFFER_OVERFLOW) {
        adapterAddresses = (IP_ADAPTER_ADDRESSES*)malloc(outBufLen);
        ret = GetAdaptersAddresses(family, flags, nullptr, adapterAddresses, &outBufLen);
    }

    if (ret == NO_ERROR) {
        for (PIP_ADAPTER_ADDRESSES adapter = adapterAddresses; adapter != nullptr; adapter = adapter->Next) {
            for (IP_ADAPTER_UNICAST_ADDRESS* addr = adapter->FirstUnicastAddress; addr != nullptr; addr = addr->Next) {
                SOCKADDR_IN* sa_in = (SOCKADDR_IN*)addr->Address.lpSockaddr;
                char buf[INET_ADDRSTRLEN] = { 0 };
                inet_ntop(AF_INET, &sa_in->sin_addr, buf, sizeof(buf));
                std::string found_ip(buf);
                if (found_ip != "127.0.0.1") {
                    ip = found_ip;
                    break;
                }
            }
            if (ip != "127.0.0.1") break;
        }
    }

    if (adapterAddresses) free(adapterAddresses);
    WSACleanup();

#else
    struct ifaddrs* ifAddrStruct = nullptr;
    struct ifaddrs* ifa = nullptr;

    if (getifaddrs(&ifAddrStruct) == -1) {
        return ip;
    }

    for (ifa = ifAddrStruct; ifa != nullptr; ifa = ifa->ifa_next) {
        if (!ifa->ifa_addr) continue;

        if (ifa->ifa_addr->sa_family == AF_INET) {
            char addressBuffer[INET_ADDRSTRLEN];
            void* tmpAddrPtr = &((struct sockaddr_in*)ifa->ifa_addr)->sin_addr;
            inet_ntop(AF_INET, tmpAddrPtr, addressBuffer, INET_ADDRSTRLEN);

            std::string found_ip(addressBuffer);
            if (found_ip != "127.0.0.1") {
                ip = found_ip;
                break;
            }
        }
    }

    if (ifAddrStruct != nullptr) freeifaddrs(ifAddrStruct);
#endif

    return ip;
}
