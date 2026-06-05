from pydantic import BaseModel, HttpUrl
from typing import Optional


class UpscaleURLRequest(BaseModel):
    url: HttpUrl
    scale: Optional[int] = None
    output_format: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    model: str
    driver: str
    driver_info: str
