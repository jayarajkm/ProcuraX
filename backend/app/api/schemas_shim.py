from dataclasses import dataclass
import uuid


@dataclass
class LineShim:
    product_id: uuid.UUID
    quantity: int
