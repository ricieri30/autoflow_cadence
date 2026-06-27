import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  email:        { type: String, unique: true, index: true },
  passwordHash: String,
  role:         { type: String, enum: ["admin","operator","viewer"], default: "admin" },
  createdAt:    { type: Date, default: Date.now },
});

const ContactSchema = new mongoose.Schema({
  name:              String,
  phoneE164:         { type: String, index: true },
  tags:              { type: [String], default: [] },
  optIn:             { type: Boolean, default: true },
  subscriptionStart: { type: Date, default: null },
  subscriptionEnd:   { type: Date, default: null, index: true },
  subscriptionNotes: { type: String, default: "" },
  createdAt:         { type: Date, default: Date.now },
});

const TemplateSchema = new mongoose.Schema({
  name:      String,
  body:      String,
  vars:      { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const RecurringSchema = new mongoose.Schema({
  name:              String,
  enabled:           { type: Boolean, default: true },
  targetType:        { type: String, enum: ["tag","phone","contact"], default: "tag" },
  targetValue:       String,
  templateId:        { type: mongoose.Schema.Types.ObjectId, ref: "Template", set: v => (v === "" || v == null ? null : v) },
  pattern:           String,
  tz:                { type: String, default: "America/Sao_Paulo" },
  startDate:         Date,
  endDate:           Date,
  limit:             Number,
  throttlePerMinute: { type: Number, default: 10 },
  quietHours: {
    start: { type: String, default: "21:00" },
    end:   { type: String, default: "08:00" },
  },
  createdAt: { type: Date, default: Date.now },
});

const ScheduledMessageSchema = new mongoose.Schema({
  name:        { type: String, default: "" },
  phoneE164:   { type: String, required: true },
  contactName: { type: String, default: "" },
  message:     { type: String, required: true },
  templateId:  { type: mongoose.Schema.Types.ObjectId, ref: "Template", default: null, set: v => (v === "" || v == null ? null : v) },
  scheduledAt: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ["pending","queued","sent","failed","cancelled"],
    default: "pending", index: true,
  },
  sentAt:       Date,
  errorMessage: String,
  bullJobId:    String,
  createdBy:    String,
  createdAt:    { type: Date, default: Date.now },
});

const AutoReplySchema = new mongoose.Schema({
  keyword:     { type: String, required: true },
  reply:       { type: String, required: true },
  targetPhone: { type: String, default: "" },
  targetName:  { type: String, default: "" },
  startTime:   { type: String, default: "00:00" },
  endTime:     { type: String, default: "23:59" },
  active:      { type: Boolean, default: true },
  createdBy:   { type: String, default: "admin" },
  createdAt:   { type: Date, default: Date.now },
});

const OnboardingConfigSchema = new mongoose.Schema({
  active:   { type: Boolean, default: true },
  delayMin: { type: Number, default: 30 },
  steps: [{
    order:          { type: Number, required: true },
        type: { type: String, enum: ["text","image","video","audio","document"], default: "text" },
    content:        { type: String, default: "" },
    mediaUrl:       { type: String, default: "" },
    delayAfterPrev: { type: Number, default: 0 },
  }],
  updatedAt: { type: Date, default: Date.now },
});

const PipelineConfigSchema = new mongoose.Schema({
  active: { type: Boolean, default: true },
  weeks: [{
    week:       { type: Number, required: true },
    dayTrigger: { type: Number, required: true },
    sendTime:   { type: String, default: "08:00" },
    message:    { type: String, default: "" },
    mediaUrl:   { type: String, default: "" },
  }],
  renewalMessage: { type: String, default: "" },
  updatedAt:      { type: Date, default: Date.now },
});

const PipelineContactSchema = new mongoose.Schema({
  contactId:           { type: mongoose.Schema.Types.ObjectId, ref: "Contact", index: true },
  phoneE164:           { type: String, required: true },
  name:                { type: String, default: "" },
  enteredAt:           { type: Date, required: true },
  currentWeek:         { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["onboarding","week1","week2","week3","renewed","ended"],
    default: "onboarding", index: true,
  },
  onboardingBullJobId: { type: String, default: "" },
  weeksSent: [{
    week:   Number,
    sentAt: Date,
    ok:     Boolean,
  }],
  renewedAt: Date,
  endedAt:   Date,
  createdAt: { type: Date, default: Date.now },
});

const AuditSchema = new mongoose.Schema({
  at:     { type: Date, default: Date.now },
  who:    String,
  action: String,
  entity: String,
  detail: String,
  ok:     Boolean,
});

export const User             = mongoose.model("User",             UserSchema);
export const Contact          = mongoose.model("Contact",          ContactSchema);
export const Template         = mongoose.model("Template",         TemplateSchema);
export const Recurring        = mongoose.model("Recurring",        RecurringSchema);
export const ScheduledMessage = mongoose.model("ScheduledMessage", ScheduledMessageSchema);
export const AutoReply        = mongoose.model("AutoReply",        AutoReplySchema);
export const OnboardingConfig = mongoose.model("OnboardingConfig", OnboardingConfigSchema);
export const PipelineConfig   = mongoose.model("PipelineConfig",   PipelineConfigSchema);
export const PipelineContact  = mongoose.model("PipelineContact",  PipelineContactSchema);
export const Audit            = mongoose.model("Audit",            AuditSchema);
