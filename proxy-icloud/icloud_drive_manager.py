import os

from pyicloud import PyiCloudService


class ErrorCode:
    OK = 1,
    FAIL = 2,


class ICloudDriveStatus:
    def __init__(self, code, message=None):
        self.code = code
        self.message = message


class ICloudDriveManager:
    def __init__(self):
        self.sessions = {}
        self.sessions_dir = os.path.join(os.getcwd(), "sessions")
        os.makedirs(self.sessions_dir, exist_ok=True)
        self._discover_local_sessions()

    def _email_path(self, session_dir):
        return os.path.join(session_dir, ".email")

    def _save_email(self, session_dir, email):
        try:
            with open(self._email_path(session_dir), "w") as f:
                f.write(email)
        except Exception as e:
            print(f"[iCloud] Warning: could not save email: {e}")

    def _load_email(self, session_dir):
        try:
            with open(self._email_path(session_dir), "r") as f:
                return f.read().strip()
        except Exception:
            return None

    def _discover_local_sessions(self):
        for entry in os.listdir(self.sessions_dir):
            user_folder = os.path.join(self.sessions_dir, entry)
            if not os.path.isdir(user_folder):
                continue

            email = self._load_email(user_folder)
            if not email:
                print(f"[iCloud] Skipping {entry}: no .email file")
                continue

            try:
                api = PyiCloudService(email, cookie_directory=user_folder)
                if not api.requires_2fa:
                    self.sessions[email] = api
                    print(f"[iCloud] Restored session for {email}")
                else:
                    print(f"[iCloud] {email} requires 2FA — user must sign in again")
            except Exception as e:
                print(f"[iCloud] Could not restore session for {email}: {e}")

    def authenticate(self, email, password):
        folder_name = email.replace("@", "_at_").replace(".", "_")
        user_cookie_dir = os.path.join(self.sessions_dir, folder_name)
        os.makedirs(user_cookie_dir, exist_ok=True)

        try:
            api = PyiCloudService(email, password, cookie_directory=user_cookie_dir)
            self.sessions[email] = api
            self._save_email(user_cookie_dir, email)

            if api.requires_2fa:
                return ICloudDriveStatus(ErrorCode.OK, "2fa")
            return ICloudDriveStatus(ErrorCode.OK, "authenticated")
        except Exception as e:
            import traceback
            traceback.print_exc()
            # Surface the full cause chain so the proxy logs show the actual Apple response
            cause = e.__cause__ or e.__context__
            detail = f"{e}"
            if cause:
                detail += f" | caused by: {cause}"
            print(f"[iCloud] authenticate failed for {email}: {detail}")
            return ICloudDriveStatus(ErrorCode.FAIL, detail)

    def verify_2fa(self, email, code):
        api = self.sessions.get(email)
        if not api:
            return ICloudDriveStatus(ErrorCode.FAIL, "No active session for this email")

        if not api.validate_2fa_code(code):
            return ICloudDriveStatus(ErrorCode.FAIL, "Invalid 2FA code")

        if not api.is_trusted_session:
            api.trust_session()

        return ICloudDriveStatus(ErrorCode.OK)
