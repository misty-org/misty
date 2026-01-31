from fastapi import HTTPException, Query, APIRouter
from fastapi.responses import Response
from pydantic import BaseModel
import os
from icloud_drive_manager import ICloudDriveManager, ICloudDriveStatus, ErrorCode

import shutil


manager = ICloudDriveManager()

router = APIRouter()

class LoginRequest(BaseModel):
    email: str
    password: str

class VerifyRequest(BaseModel):
    email: str
    code: str

@router.post("/auth/login")
def login(data: LoginRequest):
    result = manager.authenticate(data.email, data.password)
    if result.code == ErrorCode.FAIL:
        raise HTTPException(status_code=401, detail=result.message)
    return {"status": "ok", "message": result.message}

@router.post("/auth/verify")
def verify(data: VerifyRequest):
    result = manager.verify_2fa(data.email, data.code)
    if result.code == ErrorCode.FAIL:
        raise HTTPException(status_code=400, detail=result.message)
    return {"status": "ok"}

@router.get("/auth/sessions")
def get_active_sessions():
    """Returns a list of emails that are currently authenticated."""
    return {"active_accounts": list(manager.sessions.keys())}

@router.get("/drive/ls")
def list_files(email: str, path: str):
    api = manager.sessions.get(email)
    if not api:
        raise HTTPException(status_code=401, detail="Session not found")
    
    try:
        parts = [p for p in path.split("/") if p]
        print(parts)
        
        node = api.drive
        for part in parts:
            node = node[part]

        item_names = node.dir()
        items = []
        for name in item_names:
            try:
                child = node[name]
                child_type = getattr(child, 'data', {}).get('type', '')
                is_folder = child_type == 'FOLDER'
            except Exception:
                is_folder = False
            items.append({"name": name, "is_folder": is_folder})

        return {
            "email": email,
            "current_path": path,
            "items": items
        }
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Path '{path}' not found in iCloud")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/drive/download")
def download_file(email: str, filename: str, folder_path: str = ""):
    api = manager.sessions.get(email)
    if not api:
        raise HTTPException(status_code=401, detail="Session not found")

    try:
        # Traverse to the folder node
        node = api.drive
        path_parts = [p for p in folder_path.split("/") if p]
        for part in path_parts:
            node = node[part]

        # Access the file node and read its content into memory
        file_node = node[filename]
        with file_node.open(stream=True) as r:
            content = r.content

        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    except KeyError:
        raise HTTPException(
            status_code=404,
            detail=f"Path '{folder_path}/{filename}' not found in iCloud"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")