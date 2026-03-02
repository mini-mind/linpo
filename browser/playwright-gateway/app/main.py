# pyright: reportMissingModuleSource=false, reportAttributeAccessIssue=false
import os
import json
import docker
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from typing import Dict, Any

app = FastAPI()

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
PW_RUNNER_IMAGE = os.getenv("PW_RUNNER_IMAGE", "registry.cn-hangzhou.aliyuncs.com/ravin/web3d-playwright-runner:latest")

docker_client = docker.from_env()


class RunRequest(BaseModel):
    tenant_id: str
    task_id: str
    job: Dict[str, Any]


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/run")
async def run(request: RunRequest, http_request: Request):
    """Run a one-off playwright runner container with the specified job."""
    
    internal_key = http_request.headers.get("X-Internal-Key", "")
    valid_keys = [k.strip() for k in INTERNAL_API_KEY.split(",") if k.strip()]
    if internal_key not in valid_keys:
        raise HTTPException(status_code=401, detail="Invalid internal key")
    
    tenant_id = request.tenant_id
    task_id = request.task_id
    job = request.job
    
    volume_name = f"pw_ws_t_{tenant_id}"
    container = None
    
    try:
        try:
            docker_client.volumes.get(volume_name)
        except docker.errors.NotFound:
            docker_client.volumes.create(name=volume_name)
        
        env_vars = {
            "TENANT_ID": tenant_id,
            "TASK_ID": task_id,
            "JOB_JSON": json.dumps(job),
            "ARTIFACT_DIR": "/workspace/artifacts"
        }
        
        container = docker_client.containers.run(
            image=PW_RUNNER_IMAGE,
            volumes={
                volume_name: {"bind": "/workspace", "mode": "rw"}
            },
            environment=env_vars,
            detach=True
        )
        
        status_code = container.wait()["StatusCode"]
        
        logs = container.logs().decode("utf-8").strip()
        
        last_json = None
        for line in logs.split("\n"):
            line = line.strip()
            if line:
                try:
                    last_json = json.loads(line)
                except json.JSONDecodeError:
                    pass
        
        if last_json is None:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to parse runner output from logs. Logs: {logs}"
            )
        
        if status_code != 0:
            raise HTTPException(
                status_code=502,
                detail=f"Runner exited with non-zero status: {status_code}. Output: {last_json}"
            )
        
        return last_json
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Runner execution failed: {str(e)}"
        )
    finally:
        if container is not None:
            try:
                container.remove()
            except:
                pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
