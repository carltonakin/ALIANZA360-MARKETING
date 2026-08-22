import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), email: text("email").notNull(), phone: text("phone").notNull().default(""),
  social: text("social").notNull().default(""), source: text("source").notNull().default("Landing Page"),
  status: text("status").notNull().default("New"), value: real("value").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(),
  platform: text("platform").notNull(), audience: text("audience").notNull(),
  message: text("message").notNull(), budget: real("budget").notNull().default(0),
  status: text("status").notNull().default("Draft"), impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0), createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const pages = sqliteTable("landing_pages", {
  id: integer("id").primaryKey({ autoIncrement: true }), title: text("title").notNull(),
  slug: text("slug").notNull().unique(), headline: text("headline").notNull(), teaser: text("teaser").notNull().default(""),
  webinarUrl: text("webinar_url").notNull().default(""), paymentUrl: text("payment_url").notNull().default(""),
  status: text("status").notNull().default("Draft"), registrations: integer("registrations").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }), type: text("type").notNull(),
  title: text("title").notNull(), detail: text("detail").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const socialListenerConfig = sqliteTable("social_listener_config", {
  id: integer("id").primaryKey(),
  serviceUrl: text("service_url").notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  tokenIv: text("token_iv").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});
