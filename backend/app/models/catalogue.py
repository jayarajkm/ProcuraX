import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.base import Base, IdMixin, TimestampMixin


class ProductCategory(IdMixin, TimestampMixin, Base):
    __tablename__ = "product_categories"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(300), default="")
    __table_args__ = (UniqueConstraint("organization_id", "name"),)


class Product(IdMixin, TimestampMixin, Base):
    __tablename__ = "products"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"), index=True)
    sku: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    manufacturer: Mapped[str] = mapped_column(String(120), default="")
    unit_of_measure: Mapped[str] = mapped_column(String(20), default="each")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    category: Mapped[ProductCategory] = relationship(lazy="joined")
    __table_args__ = (UniqueConstraint("organization_id", "sku"), CheckConstraint("unit_price >= 0"))


class Supplier(IdMixin, TimestampMixin, Base):
    __tablename__ = "suppliers"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200), index=True)
    contact_person: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    country: Mapped[str] = mapped_column(String(80), default="")
    payment_terms: Mapped[str] = mapped_column(String(40), default="Net 30")
    avg_lead_time_days: Mapped[int] = mapped_column(Integer, default=14)
    rating: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=Decimal("3.5"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    __table_args__ = (UniqueConstraint("organization_id", "code"), CheckConstraint("rating BETWEEN 0 AND 5"))


class SupplierProduct(IdMixin, TimestampMixin, Base):
    __tablename__ = "supplier_products"
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    lead_time_days: Mapped[int] = mapped_column(Integer)
    min_order_qty: Mapped[int] = mapped_column(Integer, default=1)
    is_preferred: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("supplier_id", "product_id"),)


class Customer(IdMixin, TimestampMixin, Base):
    __tablename__ = "customers"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200), index=True)
    segment: Mapped[str] = mapped_column(String(40), default="standard")  # standard | contract | key_account
    contact_person: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str] = mapped_column(String(254), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (UniqueConstraint("organization_id", "code"),)


class SupplierPriceBreak(IdMixin, Base):
    """Buy side: what a supplier charges per unit once the order quantity reaches min_qty."""
    __tablename__ = "supplier_price_breaks"
    supplier_product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("supplier_products.id", ondelete="CASCADE"), index=True)
    min_qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    __table_args__ = (UniqueConstraint("supplier_product_id", "min_qty"), CheckConstraint("min_qty >= 1 AND unit_price >= 0"))


class SalesPriceBreak(IdMixin, Base):
    """Sell side: unit price to a customer once the quantity reaches min_qty. customer_id NULL = list price tiers."""
    __tablename__ = "sales_price_breaks"
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    min_qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    __table_args__ = (UniqueConstraint("product_id", "customer_id", "min_qty", postgresql_nulls_not_distinct=True),
                      CheckConstraint("min_qty >= 1 AND unit_price >= 0"))


class Warehouse(IdMixin, TimestampMixin, Base):
    __tablename__ = "warehouses"
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(120))
    location: Mapped[str] = mapped_column(String(200), default="")
    # who owns the stock held here: self (we), vendor (consignment stock), customer (held on the customer's behalf)
    ownership_type: Mapped[str] = mapped_column(String(10), default="self", server_default="self")
    owner_supplier_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("suppliers.id"))
    owner_customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"))
    owner_supplier: Mapped["Supplier | None"] = relationship(lazy="joined", foreign_keys=[owner_supplier_id])
    owner_customer: Mapped["Customer | None"] = relationship(lazy="joined", foreign_keys=[owner_customer_id])
    __table_args__ = (UniqueConstraint("organization_id", "code"),
                      CheckConstraint("ownership_type IN ('self','vendor','customer')"))

    @property
    def owner_name(self) -> str:
        if self.ownership_type == "vendor" and self.owner_supplier is not None: return self.owner_supplier.name
        if self.ownership_type == "customer" and self.owner_customer is not None: return self.owner_customer.name
        return "Own stock"


class Inventory(IdMixin, TimestampMixin, Base):
    __tablename__ = "inventory"
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id"), index=True)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    quantity_reserved: Mapped[int] = mapped_column(Integer, default=0)
    quantity_on_order: Mapped[int] = mapped_column(Integer, default=0)
    reorder_level: Mapped[int] = mapped_column(Integer, default=0)
    safety_stock: Mapped[int] = mapped_column(Integer, default=0)
    avg_daily_demand: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    product: Mapped[Product] = relationship(lazy="joined")
    warehouse: Mapped[Warehouse] = relationship(lazy="joined")
    __table_args__ = (
        UniqueConstraint("product_id", "warehouse_id"),
        CheckConstraint("quantity_on_hand >= 0 AND quantity_reserved >= 0 AND quantity_on_order >= 0"),
        CheckConstraint("quantity_reserved <= quantity_on_hand"),
    )


class InventoryMovement(IdMixin, Base):
    __tablename__ = "inventory_movements"
    inventory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory.id", ondelete="CASCADE"), index=True)
    movement_type: Mapped[str] = mapped_column(String(30))  # receipt, issue, adjustment, reservation
    quantity: Mapped[int] = mapped_column(Integer)  # signed
    reference: Mapped[str] = mapped_column(String(80), default="")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class DemandHistory(IdMixin, Base):
    __tablename__ = "demand_history"
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id"))
    demand_date: Mapped[date] = mapped_column(Date)
    quantity: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        UniqueConstraint("product_id", "warehouse_id", "demand_date"),
        Index("ix_demand_product_date", "product_id", "demand_date"),
    )
