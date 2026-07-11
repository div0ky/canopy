import { Job, type ShouldQueue } from "@canopy/core";

interface BobJobInput {
    
}

export class BoobJob extends Job implements ShouldQueue {
    static id = "boob-job";
    static access = "public";

    handle(_input: BobJobInput) {
        this.logger.info("I did a thing!");
    }

}
