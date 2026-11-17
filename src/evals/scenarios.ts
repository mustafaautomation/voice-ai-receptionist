import type { ServiceId } from "../clinic.js";
import type { Appointment } from "../domain/types.js";

export type ScriptAction =
  | { name: string; arguments: Record<string, unknown> }
  | {
      name: "book_appointment";
      pick: "first_slot";
      patientName: string;
      phone: string;
      service: ServiceId;
    };

export type Scenario = {
  id: string;
  description: string;
  now: string;
  appointments?: Appointment[];
  turns: Array<{ user: string; actions: ScriptAction[] }>;
  expect: {
    toolNames: string[];
    outcome: string;
    bookedCount: number;
    appointmentId?: string;
    appointmentStatus?: "booked" | "cancelled";
    startsAt?: string;
  };
};

const base = {
  notes: "",
  createdAt: "2026-11-01T15:00:00Z",
  updatedAt: "2026-11-01T15:00:00Z",
};

export const SCENARIOS: Scenario[] = [
  {
    id: "happy-path-booking",
    description: "Caller books the first open cleaning slot tomorrow morning.",
    now: "2026-11-18T15:00:00.000Z",
    turns: [
      {
        user: "Hi, this is Maya Chen. I need a cleaning tomorrow morning. My number is 312-555-0121.",
        actions: [{ name: "check_availability", arguments: { date: "2026-11-19", service: "cleaning" } }],
      },
      {
        user: "Yes, book the first opening.",
        actions: [
          {
            name: "book_appointment",
            pick: "first_slot",
            patientName: "Maya Chen",
            phone: "312-555-0121",
            service: "cleaning",
          },
        ],
      },
    ],
    expect: { toolNames: ["check_availability", "book_appointment"], outcome: "booked", bookedCount: 1 },
  },
  {
    id: "double-booking",
    description: "A second caller asks for a slot that is already booked.",
    now: "2026-11-18T15:00:00.000Z",
    appointments: [
      {
        ...base,
        id: "apt_taken",
        patientName: "Existing Patient",
        phone: "+13125550100",
        service: "cleaning",
        startsAt: "2026-11-19T14:00:00Z",
        endsAt: "2026-11-19T14:30:00Z",
        status: "booked",
      },
    ],
    turns: [
      {
        user: "Please book me at 8:00 AM tomorrow for a cleaning. I am Jordan Lee, 312-555-0199.",
        actions: [
          { name: "check_availability", arguments: { date: "2026-11-19", service: "cleaning" } },
          {
            name: "book_appointment",
            arguments: {
              start: "2026-11-19T14:00:00Z",
              patientName: "Jordan Lee",
              phone: "312-555-0199",
              service: "cleaning",
            },
          },
        ],
      },
    ],
    expect: { toolNames: ["check_availability", "book_appointment"], outcome: "slot_taken", bookedCount: 1 },
  },
  {
    id: "after-hours",
    description: "Caller asks to come in after the clinic has closed.",
    now: "2026-11-21T02:00:00.000Z",
    turns: [
      {
        user: "Can I come in tonight for a cleaning? My name is Rita Cole, 312-555-0177.",
        actions: [
          { name: "check_availability", arguments: { date: "2026-11-20", service: "cleaning" } },
          {
            name: "book_appointment",
            arguments: {
              start: "2026-11-21T02:30:00Z",
              patientName: "Rita Cole",
              phone: "312-555-0177",
              service: "cleaning",
            },
          },
        ],
      },
    ],
    expect: { toolNames: ["check_availability", "book_appointment"], outcome: "outside_hours", bookedCount: 0 },
  },
  {
    id: "reschedule",
    description: "Caller moves an exam that is outside the 24 hour window.",
    now: "2026-11-18T15:00:00.000Z",
    appointments: [
      {
        ...base,
        id: "apt_move",
        patientName: "Andre Brooks",
        phone: "+13125550122",
        service: "exam",
        startsAt: "2026-11-23T15:00:00Z",
        endsAt: "2026-11-23T15:30:00Z",
        status: "booked",
      },
    ],
    turns: [
      {
        user: "This is Andre Brooks. Please move appointment apt_move to 10:00 AM Central on Monday.",
        actions: [
          {
            name: "reschedule_appointment",
            arguments: { appointmentId: "apt_move", start: "2026-11-23T16:00:00Z" },
          },
        ],
      },
    ],
    expect: {
      toolNames: ["reschedule_appointment"],
      outcome: "rescheduled",
      bookedCount: 1,
      appointmentId: "apt_move",
      appointmentStatus: "booked",
      startsAt: "2026-11-23T16:00:00Z",
    },
  },
  {
    id: "cancel",
    description: "Caller cancels a filling outside the 24 hour window.",
    now: "2026-11-18T15:00:00.000Z",
    appointments: [
      {
        ...base,
        id: "apt_cancel",
        patientName: "Priya Shah",
        phone: "+13125550123",
        service: "filling",
        startsAt: "2026-11-24T15:00:00Z",
        endsAt: "2026-11-24T15:30:00Z",
        status: "booked",
      },
    ],
    turns: [
      {
        user: "This is Priya Shah. Please cancel appointment apt_cancel. I have a schedule conflict.",
        actions: [
          { name: "cancel_appointment", arguments: { appointmentId: "apt_cancel", reason: "schedule conflict" } },
        ],
      },
    ],
    expect: {
      toolNames: ["cancel_appointment"],
      outcome: "cancelled",
      bookedCount: 0,
      appointmentId: "apt_cancel",
      appointmentStatus: "cancelled",
    },
  },
  {
    id: "angry-caller-transfer",
    description: "An upset caller asks for a person and is transferred.",
    now: "2026-11-18T15:00:00.000Z",
    turns: [
      {
        user: "This bill is ridiculous and I do not want to talk to a machine. Get me a person.",
        actions: [
          { name: "transfer_to_human", arguments: { reason: "Caller is upset about a billing charge and asked for a person." } },
        ],
      },
    ],
    expect: { toolNames: ["transfer_to_human"], outcome: "transferred", bookedCount: 0 },
  },
  {
    id: "wrong-number",
    description: "Caller reached the clinic by mistake.",
    now: "2026-11-18T15:00:00.000Z",
    turns: [
      {
        user: "Sorry, I was trying to reach a hardware store. Wrong number.",
        actions: [],
      },
    ],
    expect: { toolNames: [], outcome: "no_booking", bookedCount: 0 },
  },
  {
    id: "faq",
    description: "Caller asks about Saturday hours and new patients, then hangs up.",
    now: "2026-11-18T15:00:00.000Z",
    turns: [
      {
        user: "Are you open Saturday, and do you take new patients?",
        actions: [],
      },
    ],
    expect: { toolNames: [], outcome: "no_booking", bookedCount: 0 },
  },
];
