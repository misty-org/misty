package api

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/kannachi323/misty/proxy/db"
)

func GetDevices(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		workspaceID := r.URL.Query().Get("workspace_id")

		var deviceList []*db.Device
		var err error

		if workspaceID != "" {
			deviceList, err = db.GetDevicesByWorkspace(database.Conn, workspaceID)
		} else {
			deviceList, err = db.GetAllDevices(database.Conn)
		}

		if err != nil {
			http.Error(w, "Failed to get db", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(deviceList)
	}
}

func RegisterDevice(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var deviceInfo struct {
			PeerHostName string `json:"peer_hostname"`
			PeerType     string `json:"peer_type"`
			PeerAddress  string `json:"peer_address"`
			DeviceName   string `json:"device_name"`
			MountPath    string `json:"mount_path"`
		}

		if r.Body != nil {
			decoder := json.NewDecoder(r.Body)
			if err := decoder.Decode(&deviceInfo); err != nil {
				http.Error(w, "Invalid JSON in request body", http.StatusBadRequest)
				return
			}
		}

		if deviceInfo.PeerHostName == "" {
			if host, err := os.Hostname(); err == nil {
				deviceInfo.PeerHostName = host
			}
		}
		deviceInfo.PeerHostName = strings.TrimSpace(deviceInfo.PeerHostName)
		if deviceInfo.PeerHostName == "" {
			http.Error(w, "peer_hostname is required", http.StatusBadRequest)
			return
		}

		if deviceInfo.PeerType == "" {
			deviceInfo.PeerType = "unknown"
		}

		if deviceInfo.PeerAddress == "" {
			host := r.RemoteAddr
			if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
				host = h
			}
			deviceInfo.PeerAddress = host
		}

		err := db.UpdateDevice(database.Conn, deviceInfo.PeerHostName, deviceInfo.PeerType, deviceInfo.PeerAddress, deviceInfo.DeviceName, deviceInfo.MountPath)
		if err != nil {
			http.Error(w, "Failed to register device", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		response := map[string]interface{}{
			"status":  "success",
			"message": "Device registered successfully",
		}

		response["peer_hostname"] = deviceInfo.PeerHostName
		response["peer_type"] = deviceInfo.PeerType
		response["peer_address"] = deviceInfo.PeerAddress

		if deviceInfo.DeviceName != "" {
			response["device_name"] = deviceInfo.DeviceName
		}
		if deviceInfo.MountPath != "" {
			response["mount_path"] = deviceInfo.MountPath
		}

		json.NewEncoder(w).Encode(response)
	}
}

func UpdateDevice(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "Device ID is required", http.StatusBadRequest)
			return
		}

		var deviceInfo struct {
			DeviceName string `json:"device_name"`
			MountPath  string `json:"mount_path"`
		}

		if r.Body != nil {
			decoder := json.NewDecoder(r.Body)
			if err := decoder.Decode(&deviceInfo); err != nil {
				http.Error(w, "Invalid JSON in request body", http.StatusBadRequest)
				return
			}
		}

		err := db.UpdateDeviceInfo(database.Conn, id, deviceInfo.DeviceName, deviceInfo.MountPath)
		if err != nil {
			http.Error(w, "Failed to update device", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "success",
			"message": "Device updated successfully",
		})
	}
}

func DeleteDevice(database *db.Database) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "Device ID is required", http.StatusBadRequest)
			return
		}

		err := db.DeleteDevice(database.Conn, id)
		if err != nil {
			http.Error(w, "Failed to delete device", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "success",
			"message": "Device deleted successfully",
		})
	}
}
