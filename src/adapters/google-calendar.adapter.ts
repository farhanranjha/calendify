import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { CalendarAdapterBase } from "./base-calendar.adapter.js";
import { ICalendarCredentials } from "../types/calender.js";
import { adjustTimeByTimezone } from "../utils/general.js";

export class GoogleCalendarAdapter extends CalendarAdapterBase {
  private auth: any;
  private oauth2Client: OAuth2Client;

  constructor(credentials: ICalendarCredentials) {
    super();
    this.oauth2Client = new OAuth2Client(credentials.clientId, credentials.clientSecret, credentials.redirectUri);
    this.auth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, credentials.redirectUri);
    this.auth.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
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

  async access(code: string): Promise<any> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);

    console.log("===tokens===> ", tokens);

    return tokens;
  }

  async getEventsInRange(startDate: string, endDate: string, timezone: string, calendarId = "primary") {
    const calendar = google.calendar({ version: "v3", auth: this.auth });

    // Convert start and end times to UTC
    const timezoneHandledStart = adjustTimeByTimezone(startDate, timezone);
    const timezoneHandledEnd = adjustTimeByTimezone(endDate, timezone);

    const events = await calendar.events.list({
      calendarId,
      timeMin: new Date(timezoneHandledStart).toISOString(),
      timeMax: new Date(timezoneHandledEnd).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    events.data.items?.forEach((event) => {
      console.log(event);
      console.log(event.start?.dateTime!);
      console.log(new Date(event.start?.dateTime!));
      console.log(new Date(event.start?.dateTime!).toISOString());
      // console.log(new Date(event.start?.dateTime || event.start?.date!).toISOString());
    });

    return (
      events.data.items?.map((event) => ({
        startDate: new Date(event.start?.dateTime || event.start?.date!).toISOString(),
        endDate: new Date(event.end?.dateTime || event.end?.date!).toISOString(),
      })) || []
    );
  }

  async createEvent(
    summary: string,
    start: string,
    end: string,
    timezone: string,
    description?: string,
    attendees?: { email: string }[],
    calendarId?: string,
  ) {
    const calendar = google.calendar({ version: "v3", auth: this.auth });

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
          { method: "email", minutes: 24 * 60 }, // Reminder 1 day before
          { method: "popup", minutes: 10 }, // Popup reminder 10 minutes before
        ],
      },
    };

    try {
      await calendar.events.insert({
        calendarId: calendarId || "primary",
        requestBody: event,
      });

      return "Successfully booked.";
    } catch (error) {
      console.error("Error creating event: ", error);
      throw new Error("Failed to save the event in Google Calendar");
    }
  }
  async refreshAccessToken() {
    try {
      if (!this.auth.credentials.refresh_token) {
        throw new Error("Refresh token is missing. Unable to refresh access token.");
      }

      const { credentials } = await this.auth.refreshAccessToken();

      this.auth.setCredentials(credentials);

      return {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || this.auth.credentials.refresh_token,
      };
    } catch (error) {
      console.error("Error refreshing access token:", error);
      throw error;
    }
  }
}
