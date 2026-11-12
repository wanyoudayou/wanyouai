/** 支付抽象（支付 API 契约 §3）：唯一在线 provider = zpay（易支付兼容）。 */
export interface PaymentOrder {
  id: number;
  merchant_order_no: string;
  user_id: string;
  sku_type: string;
  target_id: number | null;
  amount: number;
  status: string;
}

export interface NotifyVerification {
  orderNo: string;
  tradeNo: string;
  amount: number;
}

export interface PaymentProvider {
  readonly name: string;
  /** 构造平台收银台跳转；商品名 = 站名 + 商品描述（平台风控，契约 §5）。 */
  createPayment(input: { order: PaymentOrder; productName: string; notifyUrl: string; returnUrl: string; channel: "alipay" | "wxpay" }): { redirectUrl: string };
  /** 验签 + 参数形状校验；金额比对发生在 settle（需先加载订单快照）。 */
  verifyNotify(params: URLSearchParams): NotifyVerification | null;
  /** 平台查单：回调丢失补漏用。 */
  queryOrder(order: PaymentOrder): Promise<{ paid: boolean; tradeNo: string | null; amount: number | null }>;
}
