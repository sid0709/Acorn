import { Global, Module } from '@nestjs/common';
import { AcornAuthClient } from './acorn-auth-client.service';
import { AcornDbService } from './acorn-db.service';
import { AcornLibraryService } from './acorn-library.service';
import { AcornProfileService } from './acorn-profile.service';
import { AcornSessionService } from './acorn-session.service';
import { AcornUsageService } from './acorn-usage.service';

/** Everything Oak needs from Acorn's database and API. */
@Global()
@Module({
  providers: [
    AcornDbService,
    AcornSessionService,
    AcornAuthClient,
    AcornProfileService,
    AcornLibraryService,
    AcornUsageService,
  ],
  exports: [
    AcornDbService,
    AcornSessionService,
    AcornAuthClient,
    AcornProfileService,
    AcornLibraryService,
    AcornUsageService,
  ],
})
export class AcornModule {}
