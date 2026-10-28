import Link from "next/link";
import { ArrowUpRight, Check, Handshake } from "lucide-react";
import { PurchaseButton } from "@/components/reading/purchase-button";
import { formatPrice } from "@/lib/format";
import type { SiteContext } from "@/lib/get-site-config";
import "@/styles/pricing.css";

function PricingFeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul className="pricing-plan__features">
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" strokeWidth={2} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Editable page copy surrounds this server-rendered, configuration-backed slot. */
export function PricingPlans({
  commerce,
}: {
  commerce: Pick<
    SiteContext["commerce"],
    "paymentEnabled" | "subscriptionPrice"
  >;
}) {
  const price = commerce.subscriptionPrice;
  return (
    <div className="pricing-plans" aria-label="内容与合作方案">
      <div className="pricing-plans__grid">
        <section className="pricing-plan" aria-label="公开阅读">
          <h2 className="pricing-plan__label">公开阅读</h2>
          <p className="pricing-plan__price">
            <strong>免费</strong>
            <span>公开内容</span>
          </p>
          <div className="pricing-plan__divider" />
          <PricingFeatureList
            items={[
              "阅读已公开的文章",
              "查看专辑介绍与试读",
              "了解站主与服务方式",
              "注册内容按页面提示登录",
            ]}
          />
          <div className="pricing-plan__actions">
            <Link href="/blog" className="pricing-plan__cta">
              浏览公开文章
              <ArrowUpRight aria-hidden="true" />
            </Link>
            <p className="pricing-plan__note">先了解内容，再决定是否购买。</p>
          </div>
        </section>

        <section
          className={`pricing-plan${price ? " pricing-plan--featured" : ""}`}
          aria-label="年度订阅"
        >
          {price && <span className="pricing-plan__badge">年度方案</span>}
          <h2 className="pricing-plan__label">年度订阅</h2>
          <p className="pricing-plan__price">
            <strong>
              {price ? formatPrice(price.amount, price.currency) : "未配置"}
            </strong>
            {price && <span>/ 年</span>}
          </p>
          <div className="pricing-plan__divider" />
          <PricingFeatureList
            items={[
              "有效期内阅读对应订阅内容",
              "内容范围以本站权益规则为准",
              "单独购买的永久权益继续保留",
              "到期自主续购，不自动扣款",
            ]}
          />
          <div className="pricing-plan__actions">
            <div className="pricing-plan__purchase">
              <PurchaseButton
                skuType="subscription"
                label="购买年度订阅"
                enabled={!!price && commerce.paymentEnabled}
              />
            </div>
            <p className="pricing-plan__note">
              {!price
                ? "站主尚未设置订阅方案。"
                : !commerce.paymentEnabled
                  ? "暂未开通在线收款。"
                  : "购买前需登录，权益在会员中心查看。"}
            </p>
          </div>
        </section>

        <section className="pricing-plan" aria-label="按篇／专辑购买">
          <h2 className="pricing-plan__label">按篇／专辑购买</h2>
          <p className="pricing-plan__price">
            <strong>按标价</strong>
            <span>/ 篇或专辑</span>
          </p>
          <div className="pricing-plan__divider" />
          <PricingFeatureList
            items={[
              "按需选择文章或完整专辑",
              "价格与可购状态见内容页",
              "单独购买的权益永久保留",
              "订阅专享内容按页面说明开放",
            ]}
          />
          <div className="pricing-plan__actions">
            <Link href="/collections" className="pricing-plan__cta">
              挑选内容专辑
              <ArrowUpRight aria-hidden="true" />
            </Link>
            <p className="pricing-plan__note">
              也可 <Link href="/blog">按篇选购文章</Link>。
            </p>
          </div>
        </section>
      </div>

      <section className="pricing-service" aria-label="服务合作">
        <div className="pricing-service__icon" aria-hidden="true">
          <Handshake strokeWidth={1.75} />
        </div>
        <div className="pricing-service__copy">
          <h2>服务合作</h2>
          <p>
            按需求与交付范围询价，确认合作条款后履约。服务与内容订阅分别办理。
          </p>
        </div>
        <Link href="/services" className="pricing-plan__cta">
          查看服务与合作方式
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
