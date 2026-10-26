'use strict';
function trustedFrame(event){return event?.senderFrame?.url?.startsWith('mengcang://app/')&&event.senderFrame===event.sender.mainFrame;}
module.exports={trustedFrame};
