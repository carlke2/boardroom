import mongoose, { Schema } from "mongoose";

export interface ITicketCounter {
  key: string;
  seq: number;
}

const TicketCounterSchema = new Schema<ITicketCounter>({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, required: true },
});

export default mongoose.model<ITicketCounter>("TicketCounter", TicketCounterSchema);
