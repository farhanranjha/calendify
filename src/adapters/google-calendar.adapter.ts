import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { CalendarAdapterBase } from "./base-calendar.adapter";
import { ICalendarCredentials } from "../types/calender";
import { adjustTimeByTimezone } from "../utils/general";
import mongoose, { Connection } from "mongoose";
import { CalendarToken, ICalendarToken } from "../models/CalendarToken";

export class GoogleCalendarAdapter extends CalendarAdapterBase {
  private oauth2Client: OAuth2Client;
  private connection: Connection | null = null;

  constructor(credentials: ICalendarCredentials, connectionString: string) {
    super();
    this.connectDB(connectionString);
    this.oauth2Client = new OAuth2Client(credentials.clientId, credentials.clientSecret, credentials.redirectUri);
  }

  async connectDB(connectionString: string): Promise<void> {
    if (!connectionString) {
      throw new Error("MongoDB connection string is not defined");
    }

    console.log("Connecting to MongoDB with connection string:", connectionString);

    await mongoose.connect(connectionString);

    this.connection = mongoose.connection;

    this.connection.on("connected", () => {
      console.log("Mongoose connected to MongoDB");
    });

    this.connection.on("error", (err) => {
      console.error("Mongoose connection error:", err);
    });
  }

  connect(): string {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      redirect_uri: this.redirectUri,
    });

    console.log("===authUrl===> ", authUrl);
    return authUrl;
  }

  async saveToken(
    userId: string,
    tokens: {
      access_token: string;
      refresh_token?: string;
      scope: string;
      token_type: string;
      expiry_date: number;
      id_token?: string;
    },
  ): Promise<void> {
    const tokenData = {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      scope: tokens.scope,
      tokenType: tokens.token_type,
      expiryDate: new Date(tokens.expiry_date),
      idToken: tokens.id_token || null,
      updatedAt: new Date(),
    };

    await CalendarToken.updateOne({ userId }, { $set: tokenData }, { upsert: true });
  }

  async access(code: string, user_id: string): Promise<any> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    await this.saveToken(user_id, tokens);
    return tokens;
  }

  async getEventsInRange(userId: string, startDate: string, endDate: string, timezone: string, calendarId = "primary") {
    const token = await CalendarToken.findOne({ userId });
    if (!token) {
      throw new Error("User not registered!");
    }

    this.oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiryDate.getTime(),
    });

    const calendar = google.calendar({ version: "v3", auth: this.oauth2Client });
    console.log("===calendar===> ", calendar);

    const timezoneHandledStart = adjustTimeByTimezone(startDate, timezone);
    console.log("===timezoneHandledStart===> ", timezoneHandledStart);

    const timezoneHandledEnd = adjustTimeByTimezone(endDate, timezone);
    console.log("===timezoneHandledEnd===> ", timezoneHandledEnd);

    const events = await calendar.events.list({
      calendarId,
      timeMin: new Date(timezoneHandledStart).toISOString(),
      timeMax: new Date(timezoneHandledEnd).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });
    console.log("===events===> ", events);

    return (
      events.data.items?.map((event) => ({
        startDate: new Date(event.start?.dateTime || event.start?.date!).toISOString(),
        endDate: new Date(event.end?.dateTime || event.end?.date!).toISOString(),
        summary: event.summary,
        description: event.description || "",
        location: event.location || "",
      })) || []
    );
  }

  async createEvent(
    userId: string,
    summary: string,
    start: string,
    end: string,
    timezone: string,
    description?: string,
    attendees?: { email: string }[],
    calendarId?: string,
  ) {
    const token = await CalendarToken.findOne({ userId });
    if (!token) {
      throw new Error("User not registered!");
    }

    this.oauth2Client.setCredentials({
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expiry_date: token.expiryDate.getTime(),
    });

    const calendar = google.calendar({ version: "v3", auth: this.oauth2Client });

    const event = {
      summary: summary,
      description: description || "",
      start: {
        dateTime: start,
        timeZone: timezone,
      },
      end: {
        dateTime: end,
        timeZone: timezone,
      },
      attendees: attendees || [],
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 10 },
        ],
      },
    };

    try {
      const response = await calendar.events.insert({
        calendarId: calendarId || "primary",
        requestBody: event,
      });

      console.log("Event created successfully: ", response.data);
      return {
        message: "Event successfully booked.",
        eventId: response.data.id,
        eventLink: response.data.htmlLink,
      };
    } catch (error) {
      console.error("Error creating event: ", error);
      throw new Error("Failed to save the event in Google Calendar");
    }
  }

  async refreshAccessToken(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const token = await CalendarToken.findOne({ userId });
      if (!token) {
        throw new Error("User not registered!");
      }

      if (!token.refreshToken) {
        throw new Error("Refresh token is missing. Unable to refresh access token.");
      }

      this.oauth2Client.setCredentials({
        refresh_token: token.refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      await CalendarToken.updateOne(
        { userId },
        {
          accessToken: credentials.access_token,
          expiryDate: new Date(credentials.expiry_date!),
          refreshToken: credentials.refresh_token || token.refreshToken,
        },
      );

      return {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || token.refreshToken,
      };
    } catch (error) {
      console.error("Error refreshing access token:", error.message);
      throw new Error("Failed to refresh access token");
    }
  }
}
